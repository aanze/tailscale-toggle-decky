import asyncio
import json
import shutil
import subprocess

import decky

TAILSCALE = shutil.which("tailscale") or "/usr/bin/tailscale"
SYSTEMCTL = shutil.which("systemctl") or "/usr/bin/systemctl"


def _run(args, timeout=15):
    """Run a command and return (returncode, stdout, stderr). Never raises on failure."""
    try:
        proc = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        return proc.returncode, proc.stdout, proc.stderr
    except FileNotFoundError:
        return 127, "", f"{args[0]}: not found"
    except subprocess.TimeoutExpired:
        return 124, "", f"{' '.join(args)}: timed out after {timeout}s"


def _daemon_active():
    rc, out, _ = _run([SYSTEMCTL, "is-active", "tailscaled"], timeout=5)
    return out.strip() == "active"


def _peer(p):
    ips = p.get("TailscaleIPs") or []
    return {
        "name": p.get("HostName") or p.get("DNSName", "").split(".")[0],
        "os": p.get("OS", ""),
        "ip": ips[0] if ips else "",
        "online": bool(p.get("Online")),
        "exit_node": bool(p.get("ExitNode")),
    }


def build_status():
    status = {
        "installed": shutil.which("tailscale") is not None,
        "daemon": False,
        # one of: running | stopped | needs_login | no_daemon | missing | error
        "state": "missing",
        "hostname": "",
        "dns_name": "",
        "ip4": "",
        "ip6": "",
        "tailnet": "",
        "user": "",
        "version": "",
        "peers": [],
        "error": "",
    }
    if not status["installed"]:
        return status

    status["daemon"] = _daemon_active()
    if not status["daemon"]:
        status["state"] = "no_daemon"
        return status

    rc, out, err = _run([TAILSCALE, "status", "--json"], timeout=10)
    if rc != 0 or not out.strip():
        status["state"] = "error"
        status["error"] = (err or out).strip()[:300]
        return status

    try:
        data = json.loads(out)
    except json.JSONDecodeError as e:
        status["state"] = "error"
        status["error"] = f"bad json from tailscale: {e}"
        return status

    backend = data.get("BackendState", "")
    if backend == "Running":
        status["state"] = "running"
    elif backend == "NeedsLogin":
        status["state"] = "needs_login"
    else:  # Stopped, Starting, NoState...
        status["state"] = "stopped"

    me = data.get("Self") or {}
    ips = me.get("TailscaleIPs") or []
    status["hostname"] = me.get("HostName", "")
    status["dns_name"] = (me.get("DNSName") or "").rstrip(".")
    status["ip4"] = next((ip for ip in ips if ":" not in ip), "")
    status["ip6"] = next((ip for ip in ips if ":" in ip), "")
    status["tailnet"] = (data.get("CurrentTailnet") or {}).get("Name", "")
    status["version"] = data.get("Version", "")
    users = data.get("User") or {}
    uid = str(me.get("UserID", ""))
    status["user"] = (users.get(uid) or {}).get("LoginName", "")

    peers = [_peer(p) for p in (data.get("Peer") or {}).values()]
    peers.sort(key=lambda p: (not p["online"], p["name"].lower()))
    status["peers"] = peers
    return status


def set_enabled(enabled):
    if enabled:
        if not _daemon_active():
            rc, _, err = _run([SYSTEMCTL, "start", "tailscaled"], timeout=20)
            if rc != 0:
                return {"ok": False, "error": f"could not start tailscaled: {err.strip()}"}
        # No flags on purpose: reuses the prefs from the initial `tailscale up`.
        rc, out, err = _run([TAILSCALE, "up"], timeout=30)
    else:
        rc, out, err = _run([TAILSCALE, "down"], timeout=20)
    if rc != 0:
        return {"ok": False, "error": (err or out).strip()[:300]}
    return {"ok": True}


class Plugin:
    async def get_status(self):
        return await asyncio.to_thread(build_status)

    async def set_enabled(self, enabled: bool):
        decky.logger.info("tailscale %s", "up" if enabled else "down")
        result = await asyncio.to_thread(set_enabled, bool(enabled))
        if not result["ok"]:
            decky.logger.warning("tailscale toggle failed: %s", result["error"])
        return result

    async def _main(self):
        decky.logger.info("Tailscale Toggle loaded (binary: %s)", TAILSCALE)

    async def _unload(self):
        pass
