import { callable, definePlugin, toaster, useQuickAccessVisible } from "@decky/api";
import { ButtonItem, PanelSection, PanelSectionRow, ToggleField, staticClasses } from "@decky/ui";
import { FC, useCallback, useEffect, useRef, useState } from "react";

type State = "running" | "stopped" | "needs_login" | "no_daemon" | "missing" | "error";

interface Peer {
  name: string;
  os: string;
  ip: string;
  online: boolean;
  exit_node: boolean;
}

interface Status {
  installed: boolean;
  daemon: boolean;
  state: State;
  hostname: string;
  dns_name: string;
  ip4: string;
  ip6: string;
  tailnet: string;
  user: string;
  version: string;
  peers: Peer[];
  error: string;
}

const getStatus = callable<[], Status>("get_status");
const setEnabled = callable<[enabled: boolean], { ok: boolean; error?: string }>("set_enabled");

const POLL_MS = 4000;

// Tailscale-ish palette, tuned for the dark Quick Access panel.
const C = {
  on: "#4ade80",
  off: "#6b7280",
  warn: "#fbbf24",
  err: "#f87171",
  text: "#e5e7eb",
  muted: "#9ca3af",
  card: "linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)",
  border: "rgba(255,255,255,0.08)",
};

const STATE_LABEL: Record<State, { text: string; color: string }> = {
  running: { text: "Connected", color: C.on },
  stopped: { text: "Disconnected", color: C.off },
  needs_login: { text: "Not logged in", color: C.warn },
  no_daemon: { text: "Daemon stopped", color: C.off },
  missing: { text: "Tailscale not installed", color: C.err },
  error: { text: "Error", color: C.err },
};

const Dot: FC<{ color: string; size?: number; glow?: boolean }> = ({ color, size = 10, glow }) => (
  <span
    style={{
      display: "inline-block",
      width: size,
      height: size,
      borderRadius: "50%",
      background: color,
      boxShadow: glow ? `0 0 8px ${color}` : "none",
      flexShrink: 0,
    }}
  />
);

const StatusCard: FC<{ status: Status | null; busy: boolean }> = ({ status, busy }) => {
  const state = status?.state ?? "stopped";
  const label = STATE_LABEL[state];
  const running = state === "running";
  const subtitle = busy
    ? "Working…"
    : running
      ? status?.tailnet || status?.user || ""
      : state === "needs_login"
        ? "Run `sudo tailscale up` once in a terminal"
        : state === "missing"
          ? "Install the Tailscale CLI first"
          : status?.error || "";

  return (
    <div
      style={{
        margin: "4px 0 6px",
        padding: "12px 14px",
        borderRadius: 10,
        background: C.card,
        border: `1px solid ${C.border}`,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Dot color={busy ? C.warn : label.color} size={12} glow={running && !busy} />
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <span style={{ color: C.text, fontWeight: 600, fontSize: 15, lineHeight: 1.2 }}>
            {busy ? (running ? "Disconnecting" : "Connecting") : label.text}
          </span>
          {subtitle && (
            <span
              style={{
                color: C.muted,
                fontSize: 11,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {subtitle}
            </span>
          )}
        </div>
      </div>

      {running && status && (
        <div
          style={{
            marginTop: 4,
            paddingTop: 8,
            borderTop: `1px solid ${C.border}`,
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            rowGap: 3,
            columnGap: 12,
            fontSize: 12,
          }}
        >
          <span style={{ color: C.muted }}>IPv4</span>
          <span style={{ color: C.text, fontFamily: "monospace", fontSize: 14, fontWeight: 600 }}>
            {status.ip4 || "—"}
          </span>
          <span style={{ color: C.muted }}>Host</span>
          <span style={{ color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {status.dns_name || status.hostname || "—"}
          </span>
          {status.user && status.user !== status.tailnet && (
            <>
              <span style={{ color: C.muted }}>Account</span>
              <span style={{ color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {status.user}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
};

const PeerRow: FC<{ peer: Peer }> = ({ peer }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "7px 4px",
      borderBottom: `1px solid ${C.border}`,
      opacity: peer.online ? 1 : 0.55,
    }}
  >
    <Dot color={peer.online ? C.on : C.off} size={8} />
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
      <span
        style={{
          color: C.text,
          fontSize: 13,
          fontWeight: 500,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {peer.name}
        {peer.exit_node && <span style={{ color: C.warn, fontSize: 10, marginLeft: 6 }}>exit node</span>}
      </span>
      <span style={{ color: C.muted, fontSize: 11, fontFamily: "monospace" }}>{peer.ip}</span>
    </div>
    <span
      style={{
        color: C.muted,
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        padding: "2px 6px",
        borderRadius: 4,
        border: `1px solid ${C.border}`,
      }}
    >
      {peer.os || "?"}
    </span>
  </div>
);

const Content: FC = () => {
  const visible = useQuickAccessVisible();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    try {
      setStatus(await getStatus());
    } catch (e) {
      console.error("[tailscale-toggle] get_status failed", e);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [visible, refresh]);

  const onToggle = async (enabled: boolean) => {
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await setEnabled(enabled);
      if (!res.ok) {
        toaster.toast({ title: "Tailscale", body: res.error || "Toggle failed", critical: true });
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
      refresh();
    }
  };

  const state = status?.state ?? "stopped";
  const canToggle = state === "running" || state === "stopped" || state === "no_daemon";
  const peers = status?.peers ?? [];
  const onlineCount = peers.filter((p) => p.online).length;

  return (
    <>
      <PanelSection>
        <PanelSectionRow>
          <StatusCard status={status} busy={busy} />
        </PanelSectionRow>
        <PanelSectionRow>
          <ToggleField
            label="Tailscale"
            description={status?.version ? `v${status.version}` : undefined}
            checked={state === "running"}
            disabled={busy || !canToggle}
            onChange={onToggle}
          />
        </PanelSectionRow>
      </PanelSection>

      {state === "running" && (
        <PanelSection title={`Devices · ${onlineCount}/${peers.length} online`}>
          {peers.length === 0 ? (
            <PanelSectionRow>
              <span style={{ color: C.muted, fontSize: 12 }}>No other devices on this tailnet.</span>
            </PanelSectionRow>
          ) : (
            <PanelSectionRow>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {peers.map((p) => (
                  <PeerRow key={p.ip || p.name} peer={p} />
                ))}
              </div>
            </PanelSectionRow>
          )}
        </PanelSection>
      )}

      <PanelSection>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={refresh} disabled={busy}>
            Refresh
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>
    </>
  );
};

// 3×3 dot grid, in the spirit of the Tailscale mark.
const Icon: FC = () => (
  <svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor">
    {[3, 12, 21].flatMap((y, r) =>
      [3, 12, 21].map((x, c) => {
        const bright = r === 1 || (r === 2 && c === 1);
        return <circle key={`${r}${c}`} cx={x} cy={y} r={2.6} opacity={bright ? 1 : 0.35} />;
      }),
    )}
  </svg>
);

export default definePlugin(() => ({
  name: "Tailscale Toggle",
  titleView: <div className={staticClasses.Title}>Tailscale</div>,
  content: <Content />,
  icon: <Icon />,
}));
