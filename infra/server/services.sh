#!/usr/bin/env bash
# Run on the server as the login user (uses sudo): the app as a service, HTTPS in
# front of it, the two scheduled jobs and a daily database backup. Safe to run again.
set -euo pipefail
APP_HOST="${1:?app host name, e.g. app.example.com}"

# The scheduled jobs call the app on localhost with the shared secret.
cat > "$HOME/studyos-job.sh" <<'JOB'
#!/usr/bin/env bash
# Usage: studyos-job.sh maintenance|notifications
set -euo pipefail
. "$HOME/studyos.secrets.env"
curl -fsS -m 120 -X POST -H "Authorization: Bearer ${MAINTENANCE_SECRET}" \
  "http://localhost:3000/api/ops/$1" -o /dev/null -w "$1: %{http_code}\n"
JOB
chmod 700 "$HOME/studyos-job.sh"

# Daily database backup: a compressed custom-format dump in ~/backups, the
# last BACKUP_KEEP_DAYS days kept (default 14). Optional off-server copy: put
# BACKUP_RSYNC_TARGET (e.g. u123456@u123456.your-storagebox.de:studyos/) and,
# if needed, BACKUP_RSYNC_SSH (e.g. "ssh -p 23") in ~/studyos.backup.env.
# Restore into the (stopped) app's database:
#   pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL_UNPOOLED" ~/backups/<file>.dump
cat > "$HOME/studyos-backup.sh" <<'BACKUP'
#!/usr/bin/env bash
set -euo pipefail
. "$HOME/studyos.env"
[ -f "$HOME/studyos.backup.env" ] && . "$HOME/studyos.backup.env"
dir="$HOME/backups"
mkdir -p "$dir"
chmod 700 "$dir"
file="$dir/studyos-$(date -u +%Y%m%dT%H%M%SZ).dump"
umask 077
pg_dump --format=custom --compress=9 --no-owner --file="$file.partial" "${DATABASE_URL_UNPOOLED:-$DATABASE_URL}"
mv "$file.partial" "$file"
# A dump that cannot be listed is not a backup.
pg_restore --list "$file" >/dev/null
find "$dir" -name 'studyos-*.dump' -mtime +"${BACKUP_KEEP_DAYS:-14}" -delete
find "$dir" -name '*.partial' -mmin +120 -delete
if [ -n "${BACKUP_RSYNC_TARGET:-}" ]; then
  rsync -a --delete -e "${BACKUP_RSYNC_SSH:-ssh}" "$dir/" "$BACKUP_RSYNC_TARGET"
fi
echo "backup: $(basename "$file") $(du -h "$file" | cut -f1), $(ls "$dir"/studyos-*.dump | wc -l) kept"
BACKUP
chmod 700 "$HOME/studyos-backup.sh"

sudo tee /etc/systemd/system/studyos-backup.service >/dev/null <<UNIT
[Unit]
Description=StudyOS database backup
After=postgresql.service

[Service]
Type=oneshot
User=${USER}
ExecStart=${HOME}/studyos-backup.sh
UNIT

sudo tee /etc/systemd/system/studyos-backup.timer >/dev/null <<UNIT
[Unit]
Description=StudyOS database backup, daily

[Timer]
OnCalendar=*-*-* 02:45:00
RandomizedDelaySec=600
Persistent=true

[Install]
WantedBy=timers.target
UNIT

sudo tee /etc/systemd/system/studyos.service >/dev/null <<UNIT
[Unit]
Description=StudyOS app (Next.js)
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
User=${USER}
Group=${USER}
WorkingDirectory=${HOME}/studyos/.next/standalone
EnvironmentFile=${HOME}/studyos.env
EnvironmentFile=${HOME}/studyos.secrets.env
# Refuse to start with required configuration missing (same check as the Docker image).
ExecStartPre=/usr/bin/node check-env.cjs
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
UNIT

for job in maintenance notifications; do
sudo tee /etc/systemd/system/studyos-$job.service >/dev/null <<UNIT
[Unit]
Description=StudyOS scheduled job: $job
After=studyos.service

[Service]
Type=oneshot
User=${USER}
ExecStart=${HOME}/studyos-job.sh $job
UNIT
done

sudo tee /etc/systemd/system/studyos-maintenance.timer >/dev/null <<UNIT
[Unit]
Description=StudyOS data retention, daily

[Timer]
OnCalendar=*-*-* 03:30:00
RandomizedDelaySec=300
Persistent=true

[Install]
WantedBy=timers.target
UNIT

sudo tee /etc/systemd/system/studyos-notifications.timer >/dev/null <<UNIT
[Unit]
Description=StudyOS notification dispatch, every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
UNIT

# HTTPS in front of the app. flush_interval -1: AI responses stream, so
# nothing may be buffered on the way out.
sudo tee /etc/caddy/Caddyfile >/dev/null <<CADDY
$APP_HOST {
	encode zstd gzip
	reverse_proxy localhost:3000 {
		flush_interval -1
	}
}
CADDY

sudo systemctl daemon-reload
sudo systemctl enable --now studyos.service >/dev/null 2>&1
sudo systemctl restart studyos.service
sudo systemctl enable --now studyos-maintenance.timer studyos-notifications.timer studyos-backup.timer >/dev/null 2>&1
sudo systemctl reload caddy || sudo systemctl restart caddy
sleep 6
echo "== service"; systemctl is-active studyos.service
echo "== health (local)"; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/health || true
echo "== timers"; systemctl list-timers 'studyos-*' --no-pager | sed -n 1,5p
echo "== last log lines"; journalctl -u studyos.service -n 12 --no-pager | cut -c1-200
