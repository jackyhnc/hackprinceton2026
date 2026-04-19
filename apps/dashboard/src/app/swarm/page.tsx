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

interface Event {
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
  clusterIdx: number | null; // which cluster they vote for
  t: number; // 0..1 animation progress
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

interface Edge {
  from: { x: number; y: number };
  to: { x: number; y: number };
  color: string;
  t: number; // 0..1 draw progress
  pulse: number; // 0..1 glow intensity
}

// Muted palette tuned for a white canvas — saturated enough to read but not
// neon. Kept in the same index order as before so voter-chip colors map
// consistently across swarm + gallery.
const COLORS = ["#2563eb", "#059669", "#d97706", "#db2777", "#7c3aed", "#0891b2"];

export default function SwarmPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number | null>(null);
  const twinsRef = useRef<Map<string, TwinNode>>(new Map());
  const clustersRef = useRef<ClusterNode[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  const sizeRef = useRef<{ w: number; h: number }>({ w: 900, h: 600 });
  // Render reads this to know whether to freeze pulses. Ref so render() (which
  // is a stable useCallback) sees live updates without re-subscribing to RAF.
  const isDoneRef = useRef(false);

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

  // Layout twins in a circle, clusters in the center ring.
  // Labels are anonymous ("Agent 1", "Agent 2", …) so the demo reads as a
  // swarm of agents rather than a list of real shoppers.
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
      // Tag each twin with its cluster
      nodes.forEach((c) => {
        c.voters.forEach((vid) => {
          const tw = twinsRef.current.get(vid);
          if (tw) tw.clusterIdx = c.idx;
        });
      });
      // Fire edges twin → cluster
      nodes.forEach((c) => {
        c.voters.forEach((vid) => {
          const tw = twinsRef.current.get(vid);
          if (!tw) return;
          edgesRef.current.push({
            from: { x: tw.x, y: tw.y },
            to: { x: c.x, y: c.y },
            color: COLORS[c.idx % COLORS.length],
            t: 0,
            pulse: 1,
          });
        });
      });
    },
    []
  );

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

    // Fade previous frame for motion trails — white veil so the canvas
    // stays light. Higher alpha than the old dark trail because we don't
    // need as much persistence to read the motion on a bright surface.
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fillRect(0, 0, w, h);

    // Dotted background grid (dark dots on light surface)
    ctx.fillStyle = "rgba(24,24,27,0.08)";
    for (let x = 20; x < w; x += 40) {
      for (let y = 20; y < h; y += 40) {
        ctx.fillRect(x, y, 1, 1);
      }
    }

    // Edges. Once the run is done we clamp `pulse` to 0 so no edge keeps
    // throbbing after the final designs are on screen.
    edgesRef.current.forEach((e) => {
      if (e.t < 1) e.t = Math.min(1, e.t + 0.04);
      if (isDone) {
        e.pulse = 0;
      } else if (e.pulse > 0) {
        e.pulse = Math.max(0, e.pulse - 0.015);
      }
      const cx = (e.from.x + e.to.x) / 2;
      const cy = (e.from.y + e.to.y) / 2;
      const endX = e.from.x + (cx - e.from.x) * e.t * 2;
      const endY = e.from.y + (cy - e.from.y) * e.t * 2;
      const toX = e.t > 0.5 ? e.from.x + (e.to.x - e.from.x) * ((e.t - 0.5) * 2) : endX;
      const toY = e.t > 0.5 ? e.from.y + (e.to.y - e.from.y) * ((e.t - 0.5) * 2) : endY;

      ctx.beginPath();
      ctx.moveTo(e.from.x, e.from.y);
      ctx.lineTo(toX, toY);
      ctx.strokeStyle = e.color;
      ctx.globalAlpha = 0.28 + e.pulse * 0.6;
      ctx.lineWidth = 1 + e.pulse * 1.6;
      ctx.stroke();
      ctx.globalAlpha = 1;
    });

    // Twins
    twinsRef.current.forEach((tw) => {
      if (tw.state !== "pending" && tw.t < 1) tw.t = Math.min(1, tw.t + 0.05);
      const color =
        tw.clusterIdx !== null
          ? COLORS[tw.clusterIdx % COLORS.length]
          : tw.state === "thinking"
          ? "#fbbf24"
          : "#64748b";

      // halo pulse when thinking — suppressed once the run is done so the
      // final snapshot is a calm static graph.
      if (tw.state === "thinking" && !isDone) {
        const pulse = 6 + Math.sin(Date.now() / 200) * 4;
        ctx.beginPath();
        ctx.arc(tw.x, tw.y, 9 + pulse, 0, Math.PI * 2);
        ctx.fillStyle = color + "33";
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(tw.x, tw.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "rgba(24,24,27,0.35)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(39,39,42,0.82)";
      ctx.textAlign = "center";
      ctx.fillText(tw.label, tw.x, tw.y + 22);
    });

    // Clusters
    clustersRef.current.forEach((c) => {
      if (c.state !== "pending" && c.t < 1) c.t = Math.min(1, c.t + 0.04);
      const color = COLORS[c.idx % COLORS.length];
      // Only wobble-pulse the radius while actively "coding" and not after done.
      const wobble = c.state === "coding" && !isDone ? Math.sin(Date.now() / 250) * 3 : 0;
      const r = 20 + c.t * 8 + wobble;

      // outer glow — softer on white so it doesn't bloom out the cluster
      const grad = ctx.createRadialGradient(c.x, c.y, r * 0.3, c.x, c.y, r * 2.2);
      grad.addColorStop(0, color + "40");
      grad.addColorStop(1, color + "00");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r * 2.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "rgba(24,24,27,0.25)";
      ctx.lineWidth = 1.25;
      ctx.stroke();

      ctx.font = "bold 12px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "white";
      ctx.textAlign = "center";
      ctx.fillText(c.name.slice(0, 20), c.x, c.y + 4);
      if (c.state === "done") {
        ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = "rgba(39,39,42,0.75)";
        ctx.fillText("✓ generated", c.x, c.y + r + 14);
      } else if (c.state === "coding" && !isDone) {
        ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = "rgba(39,39,42,0.75)";
        ctx.fillText("coding...", c.x, c.y + r + 14);
      }
    });

    animRef.current = requestAnimationFrame(render);
  }, []);

  // Start the animation loop once
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

  // Keep the render loop in sync with the run's terminal state.
  useEffect(() => {
    isDoneRef.current = status === "done";
  }, [status]);

  // SSE subscription
  useEffect(() => {
    if (!runId) return;
    const es = new EventSource(`${BACKEND}/swarm/runs/${runId}/stream`);
    es.onmessage = (msg) => {
      try {
        const event: Event = JSON.parse(msg.data);
        handleEvent(event);
      } catch (e) {
        console.error("bad sse event", e, msg.data);
      }
    };
    es.onerror = () => {
      // Browsers auto-reconnect; if status is done, close explicitly.
      if (status === "done") es.close();
    };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const handleEvent = useCallback(
    (event: Event) => {
      setStatus(event.stage);
      switch (event.stage) {
        case "run_start":
          appendLog(`▶ run started — ${event.twin_count} twins`);
          if (event.twins) {
            layoutTwins(event.twins);
            // Anonymous labels keep the UX consistent: event log, voter
            // chips, and canvas all read "Agent N".
            const map: Record<string, string> = {};
            event.twins.forEach((t, i) => {
              map[t.id] = `Agent ${i + 1}`;
            });
            setTwinNames(map);
          }
          clustersRef.current = [];
          edgesRef.current = [];
          setConclusions(null);
          break;
        case "opinion_start": {
          const tw = twinsRef.current.get(event.twin_id!);
          if (tw) tw.state = "thinking";
          const agentLabel = event.twin_id ? twinNames[event.twin_id] : null;
          appendLog(`💭 ${agentLabel || "agent"} thinking...`);
          break;
        }
        case "opinion_done": {
          const tw = twinsRef.current.get(event.twin_id!);
          if (tw) {
            tw.state = "done";
            tw.summary = event.summary;
          }
          const agentLabel = event.twin_id ? twinNames[event.twin_id] : "";
          appendLog(`✓ ${agentLabel} — ${event.summary?.slice(0, 60) || ""}`);
          break;
        }
        case "cluster_start":
          appendLog(`⚡ clustering opinions → ${event.target_count} presets`);
          break;
        case "cluster_done":
          if (event.presets) layoutClusters(event.presets);
          appendLog(`🎯 ${event.presets?.length || 0} clusters formed`);
          break;
        case "code_start":
          appendLog(
            `🎨 matching "${event.preset_name}" → ${event.variant_display_name || "variant"}`
          );
          clustersRef.current.forEach((c) => {
            if (c.name === event.preset_name) c.state = "coding";
          });
          break;
        case "code_done":
          appendLog(
            `✨ "${event.preset_name}" ← ${event.variant_display_name || "variant"}`
          );
          clustersRef.current.forEach((c) => {
            if (c.name === event.preset_name) c.state = "done";
          });
          break;
        case "done":
          appendLog(
            event.status === "completed"
              ? `✓ run complete — ${event.assignments} assignments`
              : `✗ run failed — ${event.error}`
          );
          if (event.status === "completed" && runId) {
            // Pull the full preset set for this run from the library.
            fetch(`${BACKEND}/preset/library`)
              .then((r) => r.json())
              .then((data) => {
                const mine: LibraryPreset[] = (data.presets || []).filter(
                  (p: LibraryPreset) => p.run_id === runId
                );
                setConclusions(mine);
              })
              .catch((e) => console.error("library fetch failed", e));
          }
          break;
      }
    },
    [appendLog, layoutTwins, layoutClusters, runId, twinNames]
  );

  const startRun = useCallback(async () => {
    setStarting(true);
    setError(null);
    setLog([]);
    twinsRef.current.clear();
    clustersRef.current = [];
    edgesRef.current = [];
    try {
      const res = await fetch(`${BACKEND}/swarm/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "full" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json();
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
          <p className="text-sm text-zinc-600 mt-1">
            Watch agents form opinions, cluster, and negotiate the storefront layout in real time.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-zinc-500">
            {runId ? `run ${runId.slice(0, 8)} · ${status}` : "no run"}
          </span>
          <button
            onClick={startRun}
            disabled={starting || (status !== "idle" && status !== "done")}
            className="rounded-lg bg-zinc-900 text-white text-sm font-medium px-4 py-2 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
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

      <div className="max-w-6xl mx-auto w-full px-6 pb-12 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div className="relative rounded-xl border border-zinc-200 bg-white overflow-hidden aspect-[4/3]">
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
          {status === "idle" && (
            <div className="absolute inset-0 flex items-center justify-center text-zinc-500 text-sm">
              Click &ldquo;Run swarm&rdquo; to begin. Agents will animate as opinions form.
            </div>
          )}
          <div className="absolute bottom-3 left-3 text-[10px] font-mono text-zinc-400 flex gap-3">
            <span>● agent node</span>
            <span>● cluster</span>
            <span>— opinion edge</span>
          </div>
        </div>

        <aside className="rounded-xl border border-zinc-200 bg-white p-4 max-h-[600px] overflow-y-auto">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
            Event log
          </h3>
          {log.length === 0 ? (
            <div className="text-sm text-zinc-400">No events yet.</div>
          ) : (
            <ul className="space-y-1.5 text-xs font-mono">
              {log.map((line, i) => (
                <li key={i} className="text-zinc-700 leading-relaxed">
                  {line}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {conclusions && conclusions.length > 0 && (
        <div className="max-w-6xl mx-auto w-full px-6 pb-16">
          <div className="mb-4">
            <h2 className="text-xl font-semibold tracking-tight">Final conclusions</h2>
            <p className="text-sm text-zinc-600 mt-1">
              {conclusions.length} clusters formed. Each was matched to a hand-crafted layout variant.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {conclusions.map((p) => (
              <ClusterCard key={p.id} preset={p} twinNames={twinNames} />
            ))}
          </div>
          <div className="mt-6 text-sm">
            <a href="/presets" className="underline text-zinc-700 hover:text-zinc-900">
              View full preset gallery →
            </a>
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
  <body>
    ${preset.generated_html}
  </body>
</html>`,
    [preset]
  );

  // Derive the variant line from change_summary (we append "Layout variant: ..." on the backend).
  const variantLine = preset.change_summary
    .split("\n")
    .find((line) => line.startsWith("Layout variant:"));
  const changeBody = preset.change_summary
    .split("\n")
    .filter((line) => !line.startsWith("Layout variant:"))
    .join("\n")
    .trim();

  const voterNames = preset.voter_twin_ids
    .map((id) => twinNames[id] || id.slice(0, 6))
    .slice(0, 8);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden flex flex-col">
      <div className="p-4 border-b border-zinc-100">
        <div className="text-sm font-medium">{preset.display_name}</div>
        <div className="text-xs text-zinc-500 mt-0.5">{preset.description}</div>
        {variantLine && (
          <div className="text-[11px] font-mono text-zinc-400 mt-2">{variantLine}</div>
        )}
      </div>
      <div className="flex-1 bg-zinc-50">
        <iframe
          srcDoc={doc}
          sandbox="allow-same-origin"
          title={preset.display_name}
          className="w-full"
          style={{ height: 280, border: 0, display: "block" }}
        />
      </div>
      <div className="p-3 border-t border-zinc-100">
        <div className="text-[10px] uppercase tracking-wider text-zinc-400 mb-1.5">
          {preset.voter_twin_ids.length} voter{preset.voter_twin_ids.length === 1 ? "" : "s"}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {voterNames.map((n, i) => (
            <span
              key={i}
              className="text-[11px] bg-zinc-100 text-zinc-700 px-2 py-0.5 rounded"
            >
              {n}
            </span>
          ))}
          {preset.voter_twin_ids.length > 8 && (
            <span className="text-[11px] text-zinc-500 px-2 py-0.5">
              +{preset.voter_twin_ids.length - 8} more
            </span>
          )}
        </div>
        {changeBody && (
          <p className="text-xs text-zinc-600 leading-relaxed mt-3 line-clamp-3">
            {changeBody}
          </p>
        )}
      </div>
    </div>
  );
}
