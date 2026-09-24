# Deploying Etch

Etch is static files — no build, no backend. Hosting is an unprivileged Debian
LXC on the Proxmox host:

- **Caddy on `:80`** serves `/srv/etch` to the LAN.
- **Tailscale** terminates HTTPS on the tailnet name and proxies to that same
  Caddy, so the site is also reachable at `https://etch.<tailnet>.ts.net/`.

Use the HTTPS address by default — see *Camera and clipboard* below for why.

## This deployment

CTID **102**, hostname `etch`: Debian 13, unprivileged, 1 core / 512 MB / 4 GB
on `local-lvm`, `onboot=1`, web root `/srv/etch`.

Addresses are deliberately not recorded here — this repo is public, and the LAN
subnet and tailnet name are not worth publishing. Look them up when you need
them:

```
ssh <proxmox-host> pct list                        # the container
ssh <proxmox-host> pct exec 102 -- ip -4 -brief addr show eth0   # LAN address
ssh <proxmox-host> pct exec 102 -- tailscale status              # tailnet name
```

Rebuild from scratch with `provision-lxc.sh`, passing your own
`CT_IP=<addr>/24,gw=<gateway>`.

| File | Role |
|---|---|
| `provision-lxc.sh` | Run once **on the Proxmox host**; creates the container, installs Caddy + Tailscale. |
| `Caddyfile` | Goes to `/etc/caddy/Caddyfile` in the container. |
| `deploy.sh` | Run from the workstation; rsyncs the working tree to the web root. |

## First run

On the Proxmox host:

```
bash provision-lxc.sh
```

It prints the container's LAN address and, unless you passed `TS_AUTHKEY=`, the
two Tailscale commands to finish by hand (a login URL to click, then
`tailscale serve --bg 80`).

`tailscale serve` needs two tailnet-level things switched on, and it fails with
only the LAN `http://` address working until both are:

1. **Serve** itself. `tailscale serve` prints its own enable link when it is off
   (`Serve is not enabled on your tailnet` → `login.tailscale.com/f/serve?node=…`).
   This is the one that actually blocked the first attempt.
2. **HTTPS Certificates** — admin console → DNS → HTTPS Certificates.

Once Serve is enabled tailnet-wide, a `serve` config registered earlier takes
effect on its own; re-running the command is harmless either way.

Then from the workstation, with `<ct-ip>` from that output:

```
scp deploy/Caddyfile root@<ct-ip>:/etc/caddy/Caddyfile
ETCH_HOST=root@<ct-ip> ./deploy/deploy.sh
ssh root@<ct-ip> 'caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy'
```

Add an `ssh_config` entry named `etch` pointing at the container's tailnet
address and later deploys are just `./deploy/deploy.sh`.

## Updating

```
./deploy/deploy.sh
```

Caddy sends `no-cache` for the app's own `.js/.css/.html`, so a deploy is live
immediately — no cache-busting, no restart. Only `js/vendor/*` is cached hard
(it holds the 31 MB `ffmpeg-core.wasm`); if you ever replace a vendored library
in place, change its path or flush the browser cache.

## Camera and clipboard

Browsers withhold *secure-context* APIs on plain `http://` to anything that
isn't `localhost`. Over the **LAN address** that silently disables:

- `navigator.mediaDevices` — camera in **FIELD** and **SHAPES**, camera + screen
  capture in every legacy tool using `js/media-source.js` (blob-tracker,
  dithering, gradient-map, mesher, pixel-flow, pixelator, text, video2midi,
  flipdigits).
- `navigator.clipboard` — **TERMNL**'s "Copy". Its file exports still work.

Over the **tailnet HTTPS address** all of it works, because that certificate is
genuinely trusted. This is the reason Tailscale is in the container at all.

## Going public later

Point a domain at the container and change `:80 {` to `yourdomain {` in the
`Caddyfile`; Caddy provisions a Let's Encrypt cert by itself, given an A record
and :80/:443 reachable from the internet. The Tailscale path keeps working
alongside it, and nothing else in the config changes.

## Notes

- The container is unprivileged, so Tailscale needs `/dev/net/tun` wired in
  explicitly — `provision-lxc.sh` appends the two `lxc.*` lines to
  `/etc/pve/lxc/<CTID>.conf` before first boot, and aborts if the device is
  missing afterwards.
- Tailscale installs from its signed apt repo, not `curl | sh`, to match the
  supply-chain posture of the rest of this repo.
- Don't add a `Content-Security-Policy` header in Caddy: every page already
  ships one in a `<meta>` tag, and a second CSP intersects with the first rather
  than replacing it.
