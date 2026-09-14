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
  IPv4, DNS name, account.
- **Devices** — every peer on the tailnet, online ones first, with OS and IP.
- Polls every 4 s while the panel is open, nothing runs when it is closed.

The plugin runs its backend as root (Decky `root` flag) because talking to
`tailscaled` requires it, unless an operator was configured.

## One-time setup on the device

The plugin only toggles an existing Tailscale login; it does not do the
browser-based login for you. Once, from a terminal or SSH:

```sh
sudo systemctl enable --now tailscaled
sudo tailscale up --hostname=my-handheld    # prints a login URL, open it anywhere
```

After that, "on" and "off" from the plugin reuse those preferences. The plugin
calls `tailscale up` with no flags on purpose — Tailscale refuses to change
settings without every flag being repeated, so keep the flags for the one-time
`up` above.

## Install

Decky keeps `~/homebrew/plugins` owned by root, so copying needs `sudo`.

```sh
pnpm install
pnpm build
scripts/deploy.sh user@device      # builds, copies over SSH, installs with sudo
```

Or by hand: copy `main.py`, `plugin.json`, `package.json` and `dist/` into
`~/homebrew/plugins/tailscale-toggle/` on the device. Decky loads it on its
own; if it does not show up, `sudo systemctl restart plugin_loader`.

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

## License

MIT
