"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

type Stage =
  | "idle"
  | "run_start"
  | "opinion_start"
  | "opinion_done"
  | "cluster_start"
  | "cluster_done"
  | "code_start"
  | "code_done"
  | "done";

interface SwarmEvent {
  stage: Stage;
  twin_id?: string;
  display_name?: string;
  preset_name?: string;
  tagline?: string;
  summary?: string;
  opinion_count?: number;
  target_count?: number;
  twin_count?: number;
  twins?: { id: string; display_name: string }[];
  presets?: { name: string; tagline: string; voter_twin_ids: string[] }[];
  html_bytes?: number;
  css_bytes?: number;
  status?: string;
  assignments?: number;
  error?: string;
  cluster_idx?: number;
  variant_slug?: string;
  variant_display_name?: string;
  variant_description?: string;
}

interface LibraryPreset {
  id: string;
  display_name: string;
  description: string;
  change_summary: string;
  generated_html: string;
  generated_css: string;
  voter_twin_ids: string[];
  run_id: string;
}

interface TwinNode {
  id: string;
  label: string;
  x: number;
  y: number;
  state: "pending" | "thinking" | "done";
  clusterIdx: number | null;
  t: number;
  summary?: string;
}

interface ClusterNode {
  idx: number;
  name: string;
  tagline: string;
  x: number;
  y: number;
  state: "pending" | "coding" | "done";
  t: number;
  voters: string[];
}

// Agent → cluster vote edge
interface ClusterEdge {
  from: { x: number; y: number };
  to: { x: number; y: number };
  color: string;
  t: number;    // 0..1 draw progress
  pulse: number; // fades naturally, then stays at 0 until done
}

// Agent ↔ agent gossip edge (fake comms lines drawn during opinion phase)
interface GossipEdge {
  from: { x: number; y: number };
  to: { x: number; y: number };
  t: number;    // 0..1 draw progress
  life: number; // 1..0 fade-out (decrements after clustering starts)
}

const COLORS = ["#2563eb", "#059669", "#d97706", "#db2777", "#7c3aed", "#0891b2"];

export default function SwarmPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number | null>(null);
  const twinsRef = useRef<Map<string, TwinNode>>(new Map());
  const clustersRef = useRef<ClusterNode[]>([]);
  const clusterEdgesRef = useRef<ClusterEdge[]>([]);  // twin → cluster
  const gossipEdgesRef = useRef<GossipEdge[]>([]);    // agent ↔ agent (simulated)
  const sizeRef = useRef<{ w: number; h: number }>({ w: 900, h: 600 });
  const isDoneRef = useRef(false);
  const clusteringStartedRef = useRef(false); // triggers gossip fade
  // Sync refs so callbacks always read the current value without stale closures
  const twinNamesRef = useRef<Record<string, string>>({});
  const runIdRef = useRef<string | null>(null);

  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<Stage>("idle");
  const [log, setLog] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [twinNames, setTwinNames] = useState<Record<string, string>>({});
  const [conclusions, setConclusions] = useState<LibraryPreset[] | null>(null);

  const appendLog = useCallback((msg: string) => {
    setLog((L) => [msg, ...L].slice(0, 40));
  }, []);

  const layoutTwins = useCallback((twins: { id: string; display_name: string }[]) => {
    const { w, h } = sizeRef.current;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.42;
    const map = new Map<string, TwinNode>();
    twins.forEach((t, i) => {
      const angle = (i / twins.length) * Math.PI * 2 - Math.PI / 2;
      map.set(t.id, {
        id: t.id,
        label: `Agent ${i + 1}`,
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
        state: "pending",
        clusterIdx: null,
        t: 0,
      });
    });
    twinsRef.current = map;
  }, []);

  const layoutClusters = useCallback(
    (presets: { name: string; tagline: string; voter_twin_ids: string[] }[]) => {
      const { w, h } = sizeRef.current;
      const cx = w / 2;
      const cy = h / 2;
      const radius = Math.min(w, h) * 0.14;
      const nodes: ClusterNode[] = presets.map((p, i) => {
        const angle = (i / presets.length) * Math.PI * 2 - Math.PI / 2;
        return {
          idx: i,
          name: p.name,
          tagline: p.tagline,
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
          state: "pending",
          t: 0,
          voters: p.voter_twin_ids,
        };
      });
      clustersRef.current = nodes;
      nodes.forEach((c) => {
        c.voters.forEach((vid) => {
          const tw = twinsRef.current.get(vid);
          if (tw) tw.clusterIdx = c.idx;
        });
      });
      // Spawn cluster edges (twin → cluster)
      nodes.forEach((c) => {
        c.voters.forEach((vid) => {
          const tw = twinsRef.current.get(vid);
          if (!tw) return;
          clusterEdgesRef.current.push({
            from: { x: tw.x, y: tw.y },
            to: { x: c.x, y: c.y },
            color: COLORS[c.idx % COLORS.length],
            t: 0,
            pulse: 1,
          });
        });
      });
      // Gossip lines are done — start fading them
      clusteringStartedRef.current = true;
    },
    []
  );

  // Add fake gossip edge: twinId → random other agent
  const addGossipEdge = useCallback((fromId: string) => {
    const nodes = Array.from(twinsRef.current.values());
    if (nodes.length < 2) return;
    const from = twinsRef.current.get(fromId);
    if (!from) return;
    // Pick 1-2 random peers (not self)
    const peers = nodes.filter((n) => n.id !== fromId);
    const count = Math.min(peers.length, 1 + Math.floor(Math.random() * 2));
    for (let i = 0; i < count; i++) {
      const target = peers[Math.floor(Math.random() * peers.length)];
      gossipEdgesRef.current.push({
        from: { x: from.x, y: from.y },
        to: { x: target.x, y: target.y },
        t: 0,
        life: 1,
      });
    }
  }, []);

  // Canvas rendering loop
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { w, h } = sizeRef.current;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== w * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    const isDone = isDoneRef.current;
    const clusteringStarted = clusteringStartedRef.current;

    ctx.fillStyle = "rgba(255,255,255,0.42)";
    ctx.fillRect(0, 0, w, h);

    // Dot grid
    ctx.fillStyle = "rgba(24,24,27,0.07)";
    for (let x = 20; x < w; x += 40) {
      for (let y = 20; y < h; y += 40) {
        ctx.fillRect(x, y, 1, 1);
      }
    }

    // ── Gossip edges (agent ↔ agent, dashed light lines) ─────────────────
    // Fade out after clustering starts; remove fully dead ones.
    gossipEdgesRef.current = gossipEdgesRef.current.filter((e) => e.life > 0.01);
    gossipEdgesRef.current.forEach((e) => {
      if (e.t < 1) e.t = Math.min(1, e.t + 0.05);
      if (clusteringStarted || isDone) e.life = Math.max(0, e.life - 0.025);

      if (e.life < 0.01) return;
      const toX = e.from.x + (e.to.x - e.from.x) * e.t;
      const toY = e.from.y + (e.to.y - e.from.y) * e.t;

      ctx.save();
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(e.from.x, e.from.y);
      ctx.lineTo(toX, toY);
      ctx.strokeStyle = `rgba(100,116,139,${0.35 * e.life})`;
      ctx.lineWidth = 0.9;
      ctx.stroke();
      ctx.restore();
    });

    // ── Cluster edges (agent → cluster) ──────────────────────────────────
    // While running: pulse glow fades naturally.
    // When done: pulse snaps to 0 but base alpha is raised so lines stay
    // clearly visible as "this agent voted for that cluster".
    clusterEdgesRef.current.forEach((e) => {
      if (e.t < 1) e.t = Math.min(1, e.t + 0.035);
      if (isDone) {
        e.pulse = 0;
      } else if (e.pulse > 0) {
        e.pulse = Math.max(0, e.pulse - 0.012);
      }

      const cx = (e.from.x + e.to.x) / 2;
      const cy = (e.from.y + e.to.y) / 2;
      const midX = e.from.x + (cx - e.from.x) * Math.min(1, e.t * 2);
      const midY = e.from.y + (cy - e.from.y) * Math.min(1, e.t * 2);
      const toX = e.t > 0.5 ? e.from.x + (e.to.x - e.from.x) * ((e.t - 0.5) * 2) : midX;
      const toY = e.t > 0.5 ? e.from.y + (e.to.y - e.from.y) * ((e.t - 0.5) * 2) : midY;

      // When done, use a solid, clearly visible alpha. During animation, add
      // the pulse glow on top.
      const baseAlpha = isDone ? 0.7 : 0.3 + e.pulse * 0.55;
      ctx.beginPath();
      ctx.moveTo(e.from.x, e.from.y);
      ctx.lineTo(toX, toY);
      ctx.strokeStyle = e.color;
      ctx.globalAlpha = baseAlpha;
      ctx.lineWidth = isDone ? 1.5 : 1 + e.pulse * 1.8;
      ctx.stroke();
      ctx.globalAlpha = 1;
    });

    // ── Twin nodes ────────────────────────────────────────────────────────
    twinsRef.current.forEach((tw) => {
      if (tw.state !== "pending" && tw.t < 1) tw.t = Math.min(1, tw.t + 0.05);
      const color =
        tw.clusterIdx !== null
          ? COLORS[tw.clusterIdx % COLORS.length]
          : tw.state === "thinking"
          ? "#f59e0b"
          : "#94a3b8";

      ctx.beginPath();
      ctx.arc(tw.x, tw.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "rgba(24,24,27,0.3)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(39,39,42,0.8)";
      ctx.textAlign = "center";
      ctx.fillText(tw.label, tw.x, tw.y + 22);
    });

    // ── Cluster nodes — no glow, no wobble, no pulsing ───────────────────
    clustersRef.current.forEach((c) => {
      if (c.state !== "pending" && c.t < 1) c.t = Math.min(1, c.t + 0.04);
      const color = COLORS[c.idx % COLORS.length];
      const r = 20 + c.t * 8; // fixed radius — no sine wobble

      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "rgba(24,24,27,0.18)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.font = "bold 11px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "white";
      ctx.textAlign = "center";
      ctx.fillText(c.name.slice(0, 18), c.x, c.y + 4);
      if (c.state === "done") {
        ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = "rgba(39,39,42,0.65)";
        ctx.fillText("✓", c.x, c.y + r + 14);
      } else if (c.state === "coding") {
        ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = "rgba(39,39,42,0.65)";
        ctx.fillText("matching…", c.x, c.y + r + 14);
      }
    });

    animRef.current = requestAnimationFrame(render);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (rect) sizeRef.current = { w: rect.width, h: rect.height };
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    animRef.current = requestAnimationFrame(render);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [render]);

  useEffect(() => {
    isDoneRef.current = status === "done";
  }, [status]);

  // SSE subscription
  useEffect(() => {
    if (!runId) return;
    const es = new EventSource(`${BACKEND}/swarm/runs/${runId}/stream`);
    es.onmessage = (msg) => {
      try {
        const event: SwarmEvent = JSON.parse(msg.data);
        handleEvent(event);
      } catch (e) {
        console.error("bad sse event", e, msg.data);
      }
    };
    es.onerror = () => {
      // Use the ref — not the stale closure `status` — so we close as soon
      // as the server ends the stream after the done event.
      if (isDoneRef.current) es.close();
    };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const handleEvent = useCallback(
    (event: SwarmEvent) => {
      setStatus(event.stage);
      switch (event.stage) {
        case "run_start":
          appendLog(`▶ run started — ${event.twin_count} agents`);
          if (event.twins) {
            layoutTwins(event.twins);
            const map: Record<string, string> = {};
            event.twins.forEach((t, i) => { map[t.id] = `Agent ${i + 1}`; });
            twinNamesRef.current = map;
            setTwinNames(map);
          }
          clustersRef.current = [];
          clusterEdgesRef.current = [];
          gossipEdgesRef.current = [];
          clusteringStartedRef.current = false;
          setConclusions(null);
          break;

        case "opinion_start": {
          const tw = twinsRef.current.get(event.twin_id!);
          if (tw) tw.state = "thinking";
          addGossipEdge(event.twin_id!);
          const label = twinNamesRef.current[event.twin_id!] ?? "agent";
          appendLog(`💭 ${label} thinking...`);
          break;
        }

        case "opinion_done": {
          const tw = twinsRef.current.get(event.twin_id!);
          if (tw) { tw.state = "done"; tw.summary = event.summary; }
          const label = twinNamesRef.current[event.twin_id!] ?? "";
          appendLog(`✓ ${label} — ${event.summary?.slice(0, 60) || ""}`);
          break;
        }

        case "cluster_start":
          appendLog(`⚡ clustering → ${event.target_count} groups`);
          break;

        case "cluster_done":
          if (event.presets) layoutClusters(event.presets);
          appendLog(`🎯 ${event.presets?.length || 0} clusters formed`);
          break;

        case "code_start":
          appendLog(`🎨 "${event.preset_name}" → ${event.variant_display_name || "variant"}`);
          clustersRef.current.forEach((c) => {
            if (c.name === event.preset_name) c.state = "coding";
          });
          break;

        case "code_done":
          appendLog(`✨ "${event.preset_name}" ← ${event.variant_display_name || "variant"}`);
          clustersRef.current.forEach((c) => {
            if (c.name === event.preset_name) c.state = "done";
          });
          break;

        case "done":
          // Mark done eagerly on the ref so the SSE onerror handler can
          // close the connection before the useEffect runs (avoids a
          // re-connect → replay-done → iframe-reload cycle).
          isDoneRef.current = true;
          appendLog(
            event.status === "completed"
              ? `✓ complete — ${event.assignments} assignments`
              : `✗ failed — ${event.error}`
          );
          if (event.status === "completed") {
            // Use the ref so this never captures a stale runId.
            const currentRunId = runIdRef.current;
            fetch(`${BACKEND}/preset/library`)
              .then((r) => r.json())
              .then((data) => {
                const mine: LibraryPreset[] = (data.presets || []).filter(
                  (p: LibraryPreset) => p.run_id === currentRunId
                );
                setConclusions(mine);
              })
              .catch((e) => console.error("library fetch failed", e));
          }
          break;
      }
    },
    [appendLog, layoutTwins, layoutClusters, addGossipEdge]
    // runId intentionally excluded — we read runIdRef.current instead
  );

  const startRun = useCallback(async () => {
    setStarting(true);
    setError(null);
    setLog([]);
    twinsRef.current.clear();
    clustersRef.current = [];
    clusterEdgesRef.current = [];
    gossipEdgesRef.current = [];
    clusteringStartedRef.current = false;
    try {
      const res = await fetch(`${BACKEND}/swarm/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "full" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json();
      runIdRef.current = data.run_id; // sync mirror updated first
      setRunId(data.run_id);
      setStatus("run_start");
    } catch (e) {
      setError(String(e));
    } finally {
      setStarting(false);
    }
  }, []);

  return (
    <div className="flex-1 flex flex-col">
      <div className="max-w-6xl mx-auto w-full px-6 py-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Swarm graph</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Agents form opinions, exchange signals, cluster by preference, then vote on a layout.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-zinc-400">
            {runId ? `run ${runId.slice(0, 8)} · ${status}` : "no run"}
          </span>
          <button
            onClick={startRun}
            disabled={starting || (status !== "idle" && status !== "done")}
            className="rounded-lg bg-zinc-900 text-white text-sm font-medium px-4 py-2 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {starting ? "Starting…" : status !== "idle" && status !== "done" ? "Running…" : "Run swarm"}
          </button>
        </div>
      </div>

      {error && (
        <div className="max-w-6xl mx-auto w-full px-6 mb-3">
          <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-2">
            {error}
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto w-full px-6 pb-12 grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
        <div className="relative rounded-xl border border-zinc-200 bg-white overflow-hidden aspect-[4/3]">
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
          {status === "idle" && (
            <div className="absolute inset-0 flex items-center justify-center text-zinc-400 text-sm">
              Click &ldquo;Run swarm&rdquo; to begin.
            </div>
          )}
          <div className="absolute bottom-3 left-3 text-[10px] font-mono text-zinc-400 flex gap-3">
            <span>● agent</span>
            <span>● cluster</span>
            <span className="opacity-60">- - gossip</span>
            <span>— vote</span>
          </div>
        </div>

        <aside className="rounded-xl border border-zinc-200 bg-white p-4 max-h-[600px] overflow-y-auto">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">
            Event log
          </h3>
          {log.length === 0 ? (
            <div className="text-sm text-zinc-400">No events yet.</div>
          ) : (
            <ul className="space-y-1.5 text-xs font-mono">
              {log.map((line, i) => (
                <li key={i} className="text-zinc-600 leading-relaxed">
                  {line}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {/* Conclusions — shown after the run completes. Agents that agreed on a
          cluster are visible on the canvas pointing to it; this panel shows
          the resulting layout variant for each cluster. */}
      {conclusions && conclusions.length > 0 && (
        <div className="max-w-6xl mx-auto w-full px-6 pb-16">
          <div className="mb-5 flex items-baseline justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Final conclusions</h2>
              <p className="text-sm text-zinc-500 mt-0.5">
                {conclusions.length} clusters · each matched to a layout variant
              </p>
            </div>
            <a href="/presets" className="text-sm text-zinc-500 hover:text-zinc-900 underline transition">
              full gallery →
            </a>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {conclusions.map((p) => (
              <ClusterCard key={p.id} preset={p} twinNames={twinNames} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ClusterCard({
  preset,
  twinNames,
}: {
  preset: LibraryPreset;
  twinNames: Record<string, string>;
}) {
  const doc = useMemo(
    () => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
      body { background: white; }
      ${preset.generated_css}
    </style>
  </head>
  <body>${preset.generated_html}</body>
</html>`,
    [preset]
  );

  const variantLine = preset.change_summary
    .split("\n")
    .find((line) => line.startsWith("Layout variant:"));
  const changeBody = preset.change_summary
    .split("\n")
    .filter((line) => !line.startsWith("Layout variant:"))
    .join("\n")
    .trim();

  const voterNames = preset.voter_twin_ids
    .map((id) => twinNames[id] || `Agent ?`)
    .slice(0, 8);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden flex flex-col">
      <div className="p-4 border-b border-zinc-100">
        <div className="text-sm font-semibold">{preset.display_name}</div>
        <div className="text-xs text-zinc-500 mt-0.5">{preset.description}</div>
        {variantLine && (
          <div className="text-[11px] font-mono text-zinc-400 mt-1.5">{variantLine}</div>
        )}
      </div>
      <div className="bg-zinc-50">
        <iframe
          srcDoc={doc}
          sandbox="allow-same-origin"
          title={preset.display_name}
          className="w-full"
          style={{ height: 260, border: 0, display: "block" }}
        />
      </div>
      <div className="p-3 border-t border-zinc-100">
        <div className="text-[10px] uppercase tracking-wider text-zinc-400 mb-1.5">
          {preset.voter_twin_ids.length} agent{preset.voter_twin_ids.length === 1 ? "" : "s"} voted
        </div>
        <div className="flex flex-wrap gap-1">
          {voterNames.map((n, i) => (
            <span key={i} className="text-[11px] bg-zinc-100 text-zinc-700 px-2 py-0.5 rounded-full">
              {n}
            </span>
          ))}
          {preset.voter_twin_ids.length > 8 && (
            <span className="text-[11px] text-zinc-400 px-2 py-0.5">
              +{preset.voter_twin_ids.length - 8}
            </span>
          )}
        </div>
        {changeBody && (
          <p className="text-xs text-zinc-500 leading-relaxed mt-2 line-clamp-2">{changeBody}</p>
        )}
      </div>
    </div>
  );
}
