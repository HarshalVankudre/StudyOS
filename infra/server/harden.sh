#!/usr/bin/env bash
# One-time hardening for the StudyOS server (Debian). Run on the server as the
# login user (uses sudo), AFTER confirming key-based SSH login works for every
# account you use (this script refuses to continue otherwise):
#
#   scp infra/server/harden.sh herschel@<server>:~ && ssh herschel@<server> ./harden.sh
#
# What it does, all safe to run again:
#   1. Firewall (nftables): incoming traffic only on SSH (22), HTTP (80) and
#      HTTPS (443 TCP and UDP for HTTP/3); everything else dropped. Loopback,
#      established connections and ICMP stay allowed. Outgoing is unrestricted.
#   2. SSH: password and keyboard-interactive logins off; root may still log
#      in with a key (the `hetzner-claude` alias uses it).
#   3. Automatic security updates (unattended-upgrades).
set -euo pipefail

has_keys() { sudo test -s "$1/.ssh/authorized_keys"; }
if ! has_keys "$HOME"; then
  echo "No SSH key in $HOME/.ssh/authorized_keys: refusing to turn off password logins." >&2
  exit 1
fi
if ! has_keys /root; then
  echo "Note: root has no SSH key; root logins will be impossible after this." >&2
fi

echo "== firewall"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nftables unattended-upgrades >/dev/null
sudo tee /etc/nftables.conf >/dev/null <<'NFT'
#!/usr/sbin/nft -f
flush ruleset

table inet filter {
  chain input {
    type filter hook input priority 0; policy drop;
    iif "lo" accept
    ct state established,related accept
    ct state invalid drop
    meta l4proto { icmp, ipv6-icmp } accept
    tcp dport 22 ct state new limit rate 30/minute accept
    tcp dport { 80, 443 } accept
    udp dport 443 accept
  }
  chain forward {
    type filter hook forward priority 0; policy drop;
  }
  chain output {
    type filter hook output priority 0; policy accept;
  }
}
NFT
sudo nft -c -f /etc/nftables.conf
sudo systemctl enable --now nftables >/dev/null 2>&1
sudo systemctl restart nftables
sudo nft list ruleset | grep -E "dport|policy" | sed 's/^/  /'

echo "== ssh"
sudo tee /etc/ssh/sshd_config.d/10-studyos-hardening.conf >/dev/null <<'SSHD'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
SSHD
sudo sshd -t
sudo systemctl reload ssh
sudo sshd -T | grep -E "^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin) " | sed 's/^/  /'

echo "== automatic security updates"
echo 'APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";' | sudo tee /etc/apt/apt.conf.d/20auto-upgrades >/dev/null
sudo systemctl enable --now unattended-upgrades >/dev/null 2>&1
systemctl is-active unattended-upgrades | sed 's/^/  unattended-upgrades: /'

echo "Done. Open a NEW ssh session now to confirm you can still log in before closing this one."
