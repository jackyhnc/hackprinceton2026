"use client";

import { useEffect, useMemo, useState } from "react";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

interface Preset {
  id: string;
  display_name: string;
  description: string;
  change_summary: string;
  generated_html: string;
  generated_css: string;
  voter_twin_ids: string[];
}

export default function PresetsPage() {
  const [presets, setPresets] = useState<Preset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const res = await fetch(`${BACKEND}/preset/library`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!live) return;
        setPresets(data.presets || []);
        // Use functional setter so we don't stomp on the user's manual selection.
        setSelected((prev) =>
          prev && (data.presets || []).some((p: Preset) => p.id === prev)
            ? prev
            : (data.presets || [])[0]?.id ?? null
        );
      } catch (e) {
        if (live) setError(String(e));
      }
    };
    load();
    const id = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);

  const active = useMemo(
    () => presets?.find((p) => p.id === selected) ?? null,
    [presets, selected]
  );

  return (
    <div className="max-w-6xl mx-auto w-full px-6 py-6 flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Preset gallery</h1>
        <p className="text-sm text-neutral-600 mt-1">
          Every generated homepage variant, rendered live. Each preset is the outcome of a twin-swarm vote.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-2">
          {error}
        </div>
      )}

      {presets === null && !error && (
        <div className="text-neutral-400 text-sm">Loading&hellip;</div>
      )}

      {presets && presets.length === 0 && (
        <div className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
          No presets yet. Go to the <a className="underline" href="/swarm">Swarm</a> page and click
          &ldquo;Run swarm&rdquo;.
        </div>
      )}

      {presets && presets.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
          <aside className="flex flex-col gap-2">
            {presets.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelected(p.id)}
                className={`text-left rounded-lg border p-3 transition ${
                  selected === p.id
                    ? "border-neutral-900 bg-neutral-900 text-white"
                    : "border-neutral-200 bg-white hover:border-neutral-400"
                }`}
              >
                <div className="font-medium text-sm">{p.display_name}</div>
                <div className={`text-xs mt-0.5 ${selected === p.id ? "text-neutral-300" : "text-neutral-500"}`}>
                  {p.description}
                </div>
                <div className={`text-[10px] font-mono mt-1 ${selected === p.id ? "text-neutral-400" : "text-neutral-400"}`}>
                  {p.voter_twin_ids?.length || 0} voters
                </div>
              </button>
            ))}
          </aside>

          <section className="min-w-0 flex flex-col gap-3">
            {active ? (
              <>
                <div className="rounded-xl border border-neutral-200 bg-white p-4">
                  <div className="text-xs uppercase tracking-wider text-neutral-400 mb-1">
                    Change summary
                  </div>
                  <p className="text-sm text-neutral-700 leading-relaxed">{active.change_summary}</p>
                </div>
                <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
                  <div className="px-4 py-2 border-b border-neutral-100 text-xs font-mono text-neutral-500 flex justify-between">
                    <span>live preview</span>
                    <span>
                      {active.generated_html.length}B html · {active.generated_css.length}B css
                    </span>
                  </div>
                  <PresetFrame preset={active} />
                </div>
              </>
            ) : (
              <div className="text-neutral-400 text-sm">Select a preset to preview.</div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function PresetFrame({ preset }: { preset: Preset }) {
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
  return (
    <iframe
      srcDoc={doc}
      sandbox="allow-same-origin"
      className="w-full"
      style={{ height: 720, border: 0, display: "block" }}
      title={preset.display_name}
    />
  );
}
