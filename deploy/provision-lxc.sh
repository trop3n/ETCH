#!/usr/bin/env bash
# One-shot: create the Etch container on the Proxmox host, with Caddy on :80 for
# the LAN and Tailscale terminating HTTPS on the tailnet name.
#
# Run ON pve as root. Every value can be overridden by env var:
#   CT_IP=192.0.2.30/24,gw=192.0.2.1 TS_AUTHKEY=tskey-auth-… bash provision-lxc.sh
#
# Afterwards, from the workstation:
#   scp deploy/Caddyfile root@<ct-ip>:/etc/caddy/Caddyfile
#   ETCH_HOST=root@<ct-ip> ./deploy/deploy.sh
#   ssh root@<ct-ip> 'caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy'
set -euo pipefail

CTID="${CTID:-$(pvesh get /cluster/nextid)}"
CT_HOSTNAME="${CT_HOSTNAME:-etch}"
CT_IP="${CT_IP:-dhcp}"                    # or 192.0.2.30/24,gw=192.0.2.1
BRIDGE="${BRIDGE:-vmbr0}"
ROOTFS_STORE="${ROOTFS_STORE:-local-lvm}"
TEMPLATE_STORE="${TEMPLATE_STORE:-local}"
DISK_GB="${DISK_GB:-4}"                   # 33 MB of site + Debian + Caddy + Tailscale
CORES="${CORES:-1}"
MEMORY="${MEMORY:-512}"                   # static files; nothing runs server-side
TS_AUTHKEY="${TS_AUTHKEY:-}"              # optional; otherwise you click a URL

echo "==> creating CT $CTID ($CT_HOSTNAME) on $BRIDGE, ip=$CT_IP"

# Newest Debian standard template for THIS host's architecture, downloaded only
# if we don't have it already. The arch filter matters: the mirror carries both
# amd64 and arm64, and arm64 sorts last.
ARCH=$(dpkg --print-architecture)
pveam update >/dev/null
TEMPLATE=$(pveam available --section system \
	| awk '{print $2}' | grep -E "^debian-[0-9]+-standard_.*_${ARCH}\\.tar" | sort -V | tail -1)
[ -n "$TEMPLATE" ] || { echo "!! no debian template found for arch ${ARCH}"; exit 1; }
if ! pveam list "$TEMPLATE_STORE" | grep -q "$TEMPLATE"; then
	echo "==> downloading $TEMPLATE"
	pveam download "$TEMPLATE_STORE" "$TEMPLATE"
fi

# Created stopped: the TUN device has to be wired in before first boot.
pct create "$CTID" "${TEMPLATE_STORE}:vztmpl/${TEMPLATE}" \
	--hostname "$CT_HOSTNAME" \
	--cores "$CORES" \
	--memory "$MEMORY" \
	--swap 256 \
	--rootfs "${ROOTFS_STORE}:${DISK_GB}" \
	--net0 "name=eth0,bridge=${BRIDGE},ip=${CT_IP}" \
	--unprivileged 1 \
	--features nesting=1 \
	--onboot 1

# Tailscale needs /dev/net/tun, which an unprivileged container does not get by
# default. Char device 10:200 is the TUN/TAP misc device.
CONF="/etc/pve/lxc/${CTID}.conf"
if ! grep -q 'dev/net/tun' "$CONF"; then
	cat >>"$CONF" <<'CONFEOF'
lxc.cgroup2.devices.allow: c 10:200 rwm
lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file
CONFEOF
fi

pct start "$CTID"

echo "==> waiting for network"
for _ in $(seq 30); do
	pct exec "$CTID" -- getent hosts deb.debian.org >/dev/null 2>&1 && break
	sleep 2
done

pct exec "$CTID" -- test -c /dev/net/tun \
	|| { echo "!! /dev/net/tun missing in CT $CTID — Tailscale will not start"; exit 1; }

echo "==> installing caddy"
pct exec "$CTID" -- apt-get update -qq
pct exec "$CTID" -- apt-get install -y -qq caddy rsync curl
pct exec "$CTID" -- mkdir -p /srv/etch /var/log/caddy

# Tailscale from its signed apt repo rather than `curl … | sh`, to match this
# project's supply-chain posture (pinned SRI, vendored libs, pinned font commit).
echo "==> installing tailscale"
CODENAME=$(pct exec "$CTID" -- bash -c '. /etc/os-release; echo "$VERSION_CODENAME"')
if ! curl -fsIL "https://pkgs.tailscale.com/stable/debian/${CODENAME}.noarmor.gpg" >/dev/null 2>&1; then
	echo "   (no tailscale repo for ${CODENAME}; falling back to bookworm)"
	CODENAME=bookworm
fi
pct exec "$CTID" -- bash -c "curl -fsSL https://pkgs.tailscale.com/stable/debian/${CODENAME}.noarmor.gpg -o /usr/share/keyrings/tailscale-archive-keyring.gpg"
pct exec "$CTID" -- bash -c "curl -fsSL https://pkgs.tailscale.com/stable/debian/${CODENAME}.tailscale-keyring.list -o /etc/apt/sources.list.d/tailscale.list"
pct exec "$CTID" -- apt-get update -qq
pct exec "$CTID" -- apt-get install -y -qq tailscale

if [ -n "$TS_AUTHKEY" ]; then
	pct exec "$CTID" -- tailscale up --hostname="$CT_HOSTNAME" --authkey="$TS_AUTHKEY"
	pct exec "$CTID" -- tailscale serve --bg 80
	echo "==> serving at: $(pct exec "$CTID" -- tailscale status --json | grep -o '"DNSName":"[^"]*' | head -1 | cut -d'"' -f4)"
else
	echo
	echo "==> tailscale is installed but not logged in. Run, on the host:"
	echo "      pct exec $CTID -- tailscale up --hostname=$CT_HOSTNAME"
	echo "    click the URL it prints, then:"
	echo "      pct exec $CTID -- tailscale serve --bg 80"
	echo "    serve needs two tailnet-level toggles: Serve itself (the command"
	echo "    prints its own enable link if off) and HTTPS Certificates"
	echo "    (admin console -> DNS -> HTTPS Certificates)."
fi

echo
echo "CT $CTID is up. LAN address:"
pct exec "$CTID" -- ip -4 -brief addr show eth0
