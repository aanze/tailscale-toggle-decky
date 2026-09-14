# Tailscale Toggle for Decky

A small [Decky Loader](https://decky.xyz) plugin that turns
[Tailscale](https://tailscale.com) on or off from the Quick Access Menu and
shows what your tailnet looks like from the device: state, tailnet IP, DNS
name, and the other machines with their online status.

Written for an **AYN Odin 3 running [Armada](https://github.com/armada-os/armada)**
(which ships the Tailscale CLI without a GUI), but nothing is Armada-specific:
it needs a Linux device with Decky Loader, `tailscale`/`tailscaled` installed
and `systemd`.

## What it does

- **Toggle** — `tailscale up` / `tailscale down`. If `tailscaled` is not
  running it is started first. Turning it off keeps the daemon alive so the
  next "on" is instant.
- **Status card** — Connected / Disconnected / Not logged in / Daemon stopped,
  IPv4, DNS name, account. Press A on it to refresh.
- **Devices** — every peer on the tailnet, online ones first, with OS and IP.
- Polls every 4 s while the panel is open, nothing runs when it is closed.

The backend runs as root (Decky `root` flag) because talking to `tailscaled`
requires it.

## Before installing: log Tailscale in once

The plugin only switches an existing Tailscale login on and off; it does not
do the browser login for you. Once, from a terminal on the device (Desktop
Mode → Konsole) or over SSH:

```sh
sudo systemctl enable --now tailscaled
sudo tailscale up --hostname=my-handheld
```

`tailscale up` prints a login URL — open it on any device, approve, done.
From then on the plugin reuses those preferences. It deliberately calls
`tailscale up` with no flags: Tailscale refuses to change settings unless
every flag is repeated, so keep the flags for this one-time command.

## Install

### One line, on the device

From a terminal on the device (Desktop Mode → Konsole, or SSH):

```sh
sh -c "$(curl -fsSL https://raw.githubusercontent.com/aanze/tailscale-toggle-decky/main/install.sh)"
```

It downloads the latest release and puts it in `~/homebrew/plugins/` — that
step asks for your password because Decky keeps that folder root-owned. Run
it again to update. Decky loads the plugin on its own; if it does not show up,
`sudo systemctl restart plugin_loader`.

### From the zip

Download `tailscale-toggle.zip` from the
[latest release](https://github.com/aanze/tailscale-toggle-decky/releases/latest),
copy it to the device, then in Decky: **Settings → General → Developer mode**
on, **Settings → Developer → Install plugin from ZIP**.

### From source

On a computer with [Node.js](https://nodejs.org) 22+ and
[pnpm](https://pnpm.io) (`npm install -g pnpm`):

```sh
git clone https://github.com/aanze/tailscale-toggle-decky.git
cd tailscale-toggle-decky
pnpm install
scripts/deploy.sh user@device
```

`scripts/deploy.sh` builds, copies the plugin to the device with `scp`, then
installs it with `sudo` (asks for the device user's password).

## Development

```sh
pnpm install
pnpm watch          # rebuilds dist/ on change
```

Backend: `main.py` (two methods, `get_status` and `set_enabled`). Frontend:
`src/index.tsx` on `@decky/ui` + `@decky/api`. `get_status` wraps
`tailscale status --json`; run it with a stub `decky` module to test without
Decky:

```sh
mkdir -p /tmp/stub && printf 'import logging\nlogger=logging.getLogger("decky")\n' > /tmp/stub/decky.py
PYTHONPATH=/tmp/stub python3 -c 'import main, json; print(json.dumps(main.build_status(), indent=1))'
```

Releases are built by GitHub Actions on every `v*` tag.

## License

MIT
