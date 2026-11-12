# Render sandbox (Daytona): operator runbook

The assistant can render visuals (LaTeX equations, matplotlib plots, Graphviz
diagrams) by running commands it writes in a Daytona sandbox. **It is on in the
public deployment:** `cloudbuild.yaml` deploys with `AGENT_SANDBOX=1` and
`STUDYOS_SANDBOX_SNAPSHOT=studyos-render`. This page describes how it is
contained, what risk remains, and what the owner must do and check.

## How a render runs

1. The agent's `render-visual` skill (`src/lib/ai/skills/catalog.ts`, text in
   `src/lib/ai/sandbox/toolchain.ts`) calls `run_in_sandbox` with source files,
   commands and the output files it expects under `out/`.
2. The tool (`src/lib/ai/tools/sandbox-tool.ts`) first refuses, free and before
   anything is reserved, a run whose commands need the network or install
   software (`apt`, `pip`, `npm`, `tlmgr`, `tectonic`, `curl`, ...), and any run
   while the snapshot is known to be outdated (below).
3. It reserves the render's price, **2 credits** (`RENDER_CREDITS` in
   `src/lib/price-list.ts`), as a credit hold, and takes one slot of the daily
   render quota (`sandbox_run`: 20 a day on Free, 60 on Pro). A render also
   counts toward the assistant message's per-message ceiling.
4. The runner (`src/lib/ai/sandbox/daytona.ts`) creates an **ephemeral** sandbox
   from the snapshot with **all network blocked** (`networkBlockAll: true`;
   `STUDYOS_SANDBOX_NETWORK_ALLOWLIST` is empty in production and must stay
   so), uploads only the agent-written inputs (never workspace data or
   secrets), checks the image's toolchain version, runs the commands, downloads
   only the declared outputs, and deletes the sandbox on every exit path.
5. Only PNG/SVG outputs are kept. They are stored in the assets bucket under an
   owner-scoped key and inserted as a media block; the model sees only an
   opaque `{ assetId, mime, filename }`, never the bytes.
6. A run that delivered an image is charged its 2 credits. A run that failed,
   timed out, produced nothing usable or was refused is **not charged**: the
   hold goes back, and the agent is told what happened and to give the content
   another way (an equation as `$…$` math, a plot as a short table).

### Limits

| Limit | Value | Where |
| --- | --- | --- |
| Network | all blocked | `sandboxNetworkPolicy`, `daytona.ts` |
| One command | at most 120 s | `PER_COMMAND_TIMEOUT_SEC` |
| All commands of a run | the run's `timeoutSec`, at most 180 s | `sandbox-tool.ts` |
| Whole run (create, upload, commands, download) | commands + 120 s, then the sandbox is deleted | `daytona.ts` |
| Sandbox lifetime if a delete is missed | auto-stop after the run's budget; ephemeral | `autoStopInterval`, `ephemeral` |
| Inputs / commands / outputs | 5 files of 200 KB, 20 + 20 commands of 500 chars, 5 outputs under `out/` | `sandbox-tool.ts` |
| Renders per user | 20 a day (Free), 60 (Pro) | `USAGE_LIMITS.sandbox_run`, `src/lib/price-list.ts` |
| Concurrent agent tasks per user | 3 | `MAX_CONCURRENT_AGENT_TASKS` |
| Credits | 2 reserved before each run, charged only on a delivered image | `sandbox-quota.ts` |

## The image (offline toolchain)

With the network blocked, a render can only use what the image already
contains. The image is defined in **`infra/sandbox/Dockerfile`**: Ubuntu 24.04
with TeX Live from the distribution (`pdflatex`, `xelatex`, `latex`,
`dvisvgm`; amsmath, mathtools, siunitx, mhchem, TikZ, pgfplots, circuitikz,
standalone, xeCJK, fontspec, the European, CJK and Arabic language packs),
poppler (`pdftoppm`, `pdftocairo`), Graphviz, librsvg, Python 3 with
matplotlib, numpy, scipy and sympy from the distribution, and the Latin
Modern, DejaVu, Liberation and Noto fonts (CJK and Arabic included). Font and
Matplotlib caches are built into the image. Nothing downloads on first use:
`tectonic` and `mermaid-cli` (which fetch packages or a browser) are not used.
The build ends with a smoke test, as the sandbox user, of exactly the commands
the skill tells the agent to run; an image that cannot render fails to build.
The last step writes `/etc/studyos-render-image` with the toolchain version
(`RENDER_IMAGE_VERSION` in `src/lib/ai/sandbox/toolchain.ts`).
`src/lib/ai/sandbox/toolchain.test.ts` checks that the Dockerfile installs
every tool the skill names.

### Rebuilding the snapshot (owner)

Daytona builds the image from the Dockerfile; no local Docker is needed. From
the repository root:

```bash
# Build under a new name, then switch the service to it (no gap):
DAYTONA_API_KEY=... node infra/sandbox/build-snapshot.mjs studyos-render-v2
gcloud run services update studyos --region=us-east4 \
  --update-env-vars=STUDYOS_SANDBOX_SNAPSHOT=studyos-render-v2
# and change STUDYOS_SANDBOX_SNAPSHOT in cloudbuild.yaml to match, or the next
# deploy sets it back to studyos-render.

# Or rebuild the existing name in place (renders are refused, free, until the
# build finishes):
DAYTONA_API_KEY=... node infra/sandbox/build-snapshot.mjs studyos-render --replace
```

The build takes a while (TeX Live is large; the image is about 3 GB, and the
script asks for 6 GiB of disk: raise it if Daytona reports the disk too small,
or lower it if your Daytona plan caps disk below that).

### An old image

The snapshot deployed before this change was built from the previous recipe
(with `tectonic`, which downloads LaTeX packages on first use, so it cannot
render with the network blocked). Until the snapshot is rebuilt, the app meets
an image without the version marker and degrades cleanly: the first render
fails before any agent command runs, one error is logged (source `sandbox`,
message `Render sandbox snapshot "…" has render toolchain none, needs v2:
renders are off until it is rebuilt …`), the student's assistant says the
visual could not be rendered and gives it another way, and nothing is charged.
For the next 10 minutes no sandbox is started for renders in that instance;
then the image is checked again, so a rebuilt snapshot is picked up without a
redeploy.

## Required settings

| Variable | Value |
| --- | --- |
| `AGENT_SANDBOX` | `1` (set by `cloudbuild.yaml`) |
| `DAYTONA_API_KEY` | Secret Manager secret of the same name |
| `STUDYOS_SANDBOX_SNAPSHOT` | the snapshot built from `infra/sandbox/Dockerfile` |
| `STUDYOS_SANDBOX_NETWORK_ALLOWLIST` | **unset** (any value opens those ranges) |
| `ASSETS_BUCKET` | the GCS bucket for rendered images (also a build arg: the image CSP is scoped to it) |

The tool is not registered unless `AGENT_SANDBOX` is on and `ASSETS_BUCKET`
matches the bucket the build's CSP allows (`src/lib/ops/env.ts`).

## Residual risk

The sandbox runs model-written shell commands, and the model reads text the
student supplies, so treat every command as untrusted. What the design
contains, and what it relies on:

- **Network:** blocked by Daytona (`networkBlockAll`). StudyOS relies on
  Daytona enforcing it; it does not verify it from inside the sandbox.
- **Escape from the sandbox:** isolation between sandboxes and from Daytona's
  hosts is Daytona's (container or VM isolation, depending on the plan). A
  kernel or runtime escape would be outside StudyOS's control. Nothing secret
  is inside the sandbox to steal: no keys, no workspace data, only the
  agent-written files.
- **Cost:** a run is bounded by its timeouts, the daily quota, three
  concurrent tasks per user and credits; a missed delete is caught by
  ephemeral auto-stop. Many users at their quota at once is still real Daytona
  spend (up to 20 or 60 runs a day each, a few minutes at most each).
- **Outputs:** only declared files under `out/`, only image types, stored
  owner-scoped and served through `/api/asset/[id]` with an ownership check,
  which redirects to a short-lived signed URL on the bucket's own origin. An
  SVG shown in the page is an `<img>`, where its scripts do not run; opened
  directly, it runs on the storage origin, never on StudyOS's.
- **Content:** a render can draw anything the model writes; it is subject to
  the same content rules as the rest of the assistant's output.

## What the owner should check in Daytona

- The API key used here is scoped to this project only and stored only in
  Secret Manager (`DAYTONA_API_KEY`); rotate it if it was ever shared.
- Sandboxes from this key show **network blocked** (in the dashboard, or with
  a one-off test sandbox: `curl https://example.com` must fail).
- No sandboxes linger: the dashboard's running list should be empty between
  renders (ephemeral sandboxes are deleted after each run).
- Organization limits: a cap on concurrent sandboxes and a spending limit or
  alert, so a bug or abuse cannot run up an unbounded bill.
- The snapshot named in `STUDYOS_SANDBOX_SNAPSHOT` exists, is active, and was
  built from the current `infra/sandbox/Dockerfile` (its build log ends with
  the smoke test's `ls` of `out/`).
- After a rebuild, one live render ("render the quadratic formula as an
  image") shows the image in the page and costs 2 credits; the startup and
  error logs show no `sandbox` error.
