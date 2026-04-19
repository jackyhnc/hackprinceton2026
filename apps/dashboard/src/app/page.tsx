"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

interface SwarmRun {
  id: string;
  kind: string;
  status: string;
  twin_ids: string[];
  started_at: string;
  finished_at: string | null;
  error: string | null;
}

interface LibraryPreset {
  id: string;
  display_name: string;
  description: string;
  change_summary: string;
  voter_twin_ids: string[];
  run_id: string;
}

function relTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  const delta = Date.now() - t;
  if (delta < 0) return "just now";
  const s = Math.floor(delta / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function Home() {
  const [runs, setRuns] = useState<SwarmRun[] | null>(null);
  const [presets, setPresets] = useState<LibraryPreset[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [r1, r2] = await Promise.all([
          fetch(`${BACKEND}/swarm/runs?limit=10`).then((r) => r.json()),
          fetch(`${BACKEND}/preset/library`).then((r) => r.json()),
        ]);
        setRuns(r1.runs || []);
        setPresets(r2.presets || []);
      } catch (e) {
        setError(String(e));
      }
    };
    load();
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, []);

  const latestRun = runs?.[0] || null;
  const latestPresets = useMemo(() => {
    if (!presets || !latestRun) return [];
    return presets.filter((p) => p.run_id === latestRun.id);
  }, [presets, latestRun]);

  const winningPreset = useMemo(() => {
    if (!latestPresets.length) return null;
    return [...latestPresets].sort(
      (a, b) => (b.voter_twin_ids?.length || 0) - (a.voter_twin_ids?.length || 0)
    )[0];
  }, [latestPresets]);

  const totalShoppers = latestRun?.twin_ids?.length ?? 0;
  // Demo-only rollups — labelled as (demo) so reviewers know these aren't live numbers.
  const demoRedemptions = Math.max(0, Math.floor(totalShoppers * 0.42));
  const demoLift = totalShoppers ? `+${(totalShoppers * 0.013).toFixed(1)}%` : "—";

  return (
    <div className="max-w-6xl w-full mx-auto px-6 py-10">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">TwinStore dashboard</h1>
          <p className="text-neutral-600 mt-2 max-w-2xl text-sm">
            Digital twins mint from shopper purchase history, debate the storefront, and pick the
            layout variant each cluster responds to. Your job is to watch the rerun and ship.
          </p>
        </div>
        <Link
          href="/swarm"
          className="inline-flex items-center justify-center rounded-lg bg-neutral-900 text-white text-sm font-medium px-5 py-2.5 hover:bg-neutral-700 transition"
        >
          Run agents →
        </Link>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-2">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <Tile
          label="Last rerun"
          value={latestRun ? relTime(latestRun.finished_at ?? latestRun.started_at) : "never"}
          sub={latestRun?.status || ""}
        />
        <Tile
          label="Shoppers seen"
          value={totalShoppers ? String(totalShoppers) : "—"}
          sub="digital twins"
        />
        <Tile
          label="Winning variant"
          value={winningPreset?.display_name?.slice(0, 24) || "—"}
          sub={
            winningPreset
              ? `${winningPreset.voter_twin_ids?.length || 0} voters`
              : "awaiting rerun"
          }
        />
        <Tile label="Est. lift (demo)" value={demoLift} sub={`${demoRedemptions} redemptions`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        <section className="rounded-xl border border-neutral-200 bg-white">
          <div className="flex items-center justify-between p-4 border-b border-neutral-100">
            <div>
              <h2 className="text-sm font-semibold tracking-tight">Latest cluster split</h2>
              <p className="text-xs text-neutral-500 mt-0.5">
                How the last rerun grouped your shoppers.
              </p>
            </div>
            <Link href="/presets" className="text-xs text-neutral-500 hover:text-neutral-900">
              full gallery →
            </Link>
          </div>
          {!latestRun ? (
            <Empty text="No reruns yet. Click Run agents to synthesize clusters." />
          ) : latestPresets.length === 0 ? (
            <Empty text="Rerun is still pending. Open /swarm for live progress." />
          ) : (
            <ul className="divide-y divide-neutral-100">
              {latestPresets.map((p) => {
                const total = totalShoppers || 1;
                const share = ((p.voter_twin_ids?.length || 0) / total) * 100;
                return (
                  <li key={p.id} className="p-4">
                    <div className="flex items-baseline justify-between gap-3 mb-1.5">
                      <div className="font-medium text-sm truncate">{p.display_name}</div>
                      <div className="text-xs font-mono text-neutral-500 shrink-0">
                        {p.voter_twin_ids?.length || 0} / {totalShoppers}
                      </div>
                    </div>
                    <div className="text-xs text-neutral-500 mb-2 line-clamp-1">
                      {p.description}
                    </div>
                    <div className="h-1.5 bg-neutral-100 rounded overflow-hidden">
                      <div
                        className="h-full bg-neutral-800"
                        style={{ width: `${share.toFixed(1)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside className="rounded-xl border border-neutral-200 bg-white">
          <div className="p-4 border-b border-neutral-100">
            <h2 className="text-sm font-semibold tracking-tight">Recent reruns</h2>
            <p className="text-xs text-neutral-500 mt-0.5">Last 10.</p>
          </div>
          {!runs || runs.length === 0 ? (
            <Empty text="No runs yet." />
          ) : (
            <ul className="divide-y divide-neutral-100">
              {runs.map((r) => (
                <li key={r.id} className="p-3 text-xs flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-neutral-700 truncate">
                      {r.id.slice(0, 8)}{" "}
                      <span className="text-neutral-400">· {r.kind}</span>
                    </div>
                    <div className="text-neutral-500 mt-0.5">
                      {relTime(r.finished_at ?? r.started_at)} · {r.twin_ids?.length || 0} twins
                    </div>
                  </div>
                  <StatusPill status={r.status} />
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="text-[10px] uppercase tracking-wider text-neutral-400">{label}</div>
      <div className="text-xl font-semibold mt-1 truncate">{value}</div>
      {sub && <div className="text-[11px] text-neutral-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
    running: "bg-blue-50 text-blue-700 border-blue-200",
    pending: "bg-amber-50 text-amber-700 border-amber-200",
    error: "bg-rose-50 text-rose-700 border-rose-200",
  };
  const cls = map[status] || "bg-neutral-100 text-neutral-600 border-neutral-200";
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${cls}`}>
      {status}
    </span>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="p-6 text-center text-sm text-neutral-400">{text}</div>;
}
