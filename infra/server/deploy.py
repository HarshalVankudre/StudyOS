#!/usr/bin/env python3
"""Deploy the APP (signed-in app, API, AI routes, jobs) to our own server.

The public website is a separate deployment on Vercel that redirects app-only
paths here (see src/lib/ops/site-split.ts). This script uploads the working
tree, builds on the server, applies pending database migrations
(`prisma migrate deploy`) and restarts the service. No secret is printed.

  python infra/server/deploy.py --host herschel@95.216.184.152 \
      --identity ~/.ssh/<key> --app-origin https://app.example.com

What ends up on the server (home of the login user):
  ~/studyos/              the source and its build (.next/standalone is what runs)
  ~/studyos.env           from the local .env.local, with the database pointed
                          at the server's own Postgres and the public URL set
                          to --app-origin. Rewritten on every deploy.
  ~/studyos.secrets.env   MAINTENANCE_SECRET and FEED_URL_KEY, generated once
                          on the server and kept across deploys.
  services.sh             (this folder) installs the systemd service, the
                          HTTPS proxy and the two scheduled jobs; run on the
                          first deploy and whenever it changes (--services).

Uploaded: tracked files plus untracked files .gitignore does not exclude, so
no .env*, no node_modules, and none of the local-only font files.
"""
import argparse
import os
import subprocess
import sys
import time
from urllib.parse import urlparse, urlunparse

# Build output carries symbols like "✓"; a Windows console (cp1252) cannot
# print them, and a crash there would leave a built but unrestarted server.
for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(errors="replace")
    except AttributeError:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))

parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
parser.add_argument("--host", required=True, help="SSH login, e.g. herschel@95.216.184.152")
parser.add_argument("--identity", help="SSH private key file (default: SSH's own choice)")
parser.add_argument("--app-origin", required=True, help="public address of the app, e.g. https://app.example.com")
parser.add_argument("--env-file", default=os.path.join(ROOT, ".env.local"), help="local env file to take settings from")
parser.add_argument("--services", action="store_true", help="also (re)install the service, proxy and scheduled jobs")
args = parser.parse_args()

app_origin = args.app_origin.rstrip("/")
app_host = urlparse(app_origin).netloc
if not app_origin.startswith("https://") or not app_host:
    sys.exit("--app-origin must be an https origin, e.g. https://app.example.com")

SSH = ["ssh", "-o", "BatchMode=yes", "-o", "ServerAliveInterval=30"]
if args.identity:
    SSH += ["-o", "IdentitiesOnly=yes", "-i", os.path.expanduser(args.identity)]
SSH.append(args.host)


def remote(command, stdin=None, check=True):
    r = subprocess.run(SSH + [command], input=stdin, capture_output=True)
    text = (r.stdout + r.stderr).decode(errors="replace").strip()
    if text:
        print(text)
    if check and r.returncode:
        sys.exit(f"remote step failed ({r.returncode})")
    return r.returncode


# 1. Settings ---------------------------------------------------------------
env = {}
for line in open(args.env_file, encoding="utf-8"):
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    env[key.strip()] = value.strip().strip('"').strip("'")


def on_server(url):
    """The same database URL, reached from the server itself."""
    parsed = urlparse(url)
    credentials = parsed.netloc.rsplit("@", 1)[0]
    return urlunparse(parsed._replace(netloc=f"{credentials}@127.0.0.1:5432"))


out = dict(env)
for key in ("DATABASE_URL", "DATABASE_URL_UNPOOLED"):
    if key in out:
        out[key] = on_server(out[key])
out.update({
    "NODE_ENV": "production",
    "PORT": "3000",
    # "localhost", not 127.0.0.1: Next.js compares a middleware rewrite with
    # its own address, which it writes as localhost; any other spelling makes
    # it proxy every request to itself. ipv4first keeps the bind on 127.0.0.1,
    # so the port is never reachable from outside.
    "HOSTNAME": "localhost",
    "NODE_OPTIONS": "--dns-result-order=ipv4first",
    "NEXT_TELEMETRY_DISABLED": "1",
    "APP_URL": app_origin,
    "NEXT_PUBLIC_APP_URL": app_origin,
    "DEPLOYMENT_VERSION": time.strftime("%Y%m%d%H%M%S"),
})
# Belongs to the website deployment only; this IS the app.
out.pop("STUDYOS_APP_ORIGIN", None)
# Vercel's CLI appends this to .env.local when linking; it is not ours.
out.pop("VERCEL_OIDC_TOKEN", None)
unsafe = [k for k, v in out.items() if "\n" in v or "'" in v]
if unsafe:
    sys.exit(f"values with quotes or newlines need manual handling: {unsafe}")
# Single-quoted, so the same file works for `source` and for systemd.
env_text = "".join(f"{k}='{v}'\n" for k, v in sorted(out.items()))
print("settings:", " ".join(sorted(out)))
remote(
    "umask 077; cat > ~/studyos.env; "
    "if [ ! -f ~/studyos.secrets.env ]; then "
    "printf \"MAINTENANCE_SECRET='%s'\\nFEED_URL_KEY='%s'\\n\" "
    "\"$(openssl rand -hex 32)\" \"$(openssl rand -base64 32)\" > ~/studyos.secrets.env; "
    "echo 'generated ~/studyos.secrets.env'; fi",
    stdin=env_text.encode(),
)

# 2. Source -----------------------------------------------------------------
listing = subprocess.run(
    ["git", "ls-files", "-co", "--exclude-standard", "-z"], cwd=ROOT, capture_output=True, check=True
).stdout
skip = (b"docs/", b"e2e/", b"marketing/")
files = [
    f for f in listing.split(b"\0")
    if f and not f.startswith(skip) and os.path.exists(os.path.join(ROOT, f.decode()))
]
print(f"uploading {len(files)} files")
tar = subprocess.Popen(["tar", "--null", "-T", "-", "-czf", "-"], cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
unpack = subprocess.Popen(SSH + ["mkdir -p ~/studyos && tar xzf - -C ~/studyos"], stdin=tar.stdout, stderr=subprocess.PIPE)
tar.stdin.write(b"\0".join(files))
tar.stdin.close()
tar.stdout.close()
_, err = unpack.communicate()
if unpack.returncode or tar.wait():
    sys.exit(f"upload failed: {err.decode(errors='replace')[:300]}")

# 3. Build and restart --------------------------------------------------------
print("building on the server (a few minutes)")
remote(
    "set -eo pipefail; cd ~/studyos; "
    "set -a; . ~/studyos.env; . ~/studyos.secrets.env; set +a; "
    # The build needs more memory than the runtime; the server has swap for it.
    "export NODE_OPTIONS=--max-old-space-size=3072 CI=1; "
    # devDependencies are needed to build, whatever NODE_ENV says.
    "NODE_ENV=development pnpm install --frozen-lockfile --prod=false 2>&1 | tail -1; "
    "pnpm run build 2>&1 | grep -E 'Compiled|rror|Failed|built ' | head -12; "
    # The standalone server does not bundle static assets (as in the Dockerfile).
    "cp -r public .next/standalone/; "
    "mkdir -p .next/standalone/.next; rm -rf .next/standalone/.next/static; "
    "cp -r .next/static .next/standalone/.next/; "
    "test -f .next/standalone/server.js && echo build ok"
)
# Pending migrations go in before the new build starts serving. They only add
# (new tables and columns), so the old build keeps working until the restart;
# a failed migration stops the deploy with the old build still running.
print("applying database migrations")
remote(
    "set -eo pipefail; cd ~/studyos; "
    "set -a; . ~/studyos.env; . ~/studyos.secrets.env; set +a; "
    "pnpm exec prisma migrate deploy 2>&1 | grep -E 'migrations? (found|applied)|Applying|No pending|rror' | head -20"
)
if args.services:
    script = open(os.path.join(HERE, "services.sh"), "rb").read().replace(b"\r\n", b"\n")
    remote("cat > ~/studyos-services.sh && chmod 700 ~/studyos-services.sh", stdin=script)
    remote(f"~/studyos-services.sh {app_host}")
else:
    remote("sudo systemctl restart studyos.service && sleep 6 && echo \"service: $(systemctl is-active studyos.service)\"")
remote(f"curl -s -o /dev/null -m 30 -w 'health: %{{http_code}}\\n' {app_origin}/api/health", check=False)

# Smoke test through the public address: every page a visitor can reach
# without signing in should answer 200 (a redirect is followed once).
SMOKE_PATHS = ["/", "/pricing", "/terms", "/privacy", "/sign-in", "/sign-up",
               "/robots.txt", "/sitemap.xml", "/manifest.webmanifest"]
probe = "; ".join(
    f"printf '%-22s %s\\n' '{p}' \"$(curl -s -L --max-redirs 1 -o /dev/null -m 30 -w '%{{http_code}}' {app_origin}{p})\""
    for p in SMOKE_PATHS
)
print("smoke test")
remote(probe, check=False)
