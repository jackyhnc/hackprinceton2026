"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

interface Twin {
  id: string;
  display_name: string;
  raw_txn_count: number;
  price_sensitivity_hint: string | null;
  persona_doc: string | null;
  created_at: string;
}

interface Preset {
  id: string;
  display_name: string;
  description: string | null;
  change_summary: string | null;
  generated_html: string;
  generated_css: string;
}

interface Assignment {
  score_0_10: number | null;
  reasoning: string | null;
}

interface ProfileData {
  twin: Twin | null;
  preset: Preset | null;
  assignment: Assignment | null;
  reason?: string;
}

export default function ShopperPage() {
  const params = useParams();
  const externalUserId = params.externalUserId as string;

  const [data, setData] = useState<ProfileData | null>(null);
  const [polling, setPolling] = useState(true);
  const [attempts, setAttempts] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!externalUserId) return;

    let live = true;
    let pollId: ReturnType<typeof setInterval>;

    const fetchProfile = async () => {
      try {
        // Try to get twin by session ID
        const [twinRes, presetRes] = await Promise.all([
          fetch(`${BACKEND}/twins/by-session/${externalUserId}`),
          fetch(`${BACKEND}/preset-for-session/${externalUserId}`),
        ]);

        const twinData = await twinRes.json();
        const presetData = await presetRes.json();

        if (!live) return;

        setAttempts((a) => a + 1);

        const twin = twinData.twin ?? null;
        const preset = presetData.preset ?? null;
        const assignment = presetData.assignment ?? null;
        const reason = presetData.reason;

        setData({ twin, preset, assignment, reason });

        // Stop polling once we have a twin and preset
        if (twin && preset) {
          setPolling(false);
          clearInterval(pollId);
        }
      } catch (e) {
        if (live) setError(String(e));
      }
    };

    fetchProfile();
    pollId = setInterval(fetchProfile, 2500);

    return () => {
      live = false;
      clearInterval(pollId);
    };
  }, [externalUserId]);

  const hasTwin = data?.twin != null;
  const hasPreset = data?.preset != null;

  return (
    <div className="max-w-5xl mx-auto w-full px-6 py-10">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 text-xs text-zinc-400 mb-3">
          <Link href="/" className="hover:text-zinc-600">Dashboard</Link>
          <span>/</span>
          <span>Shopper profile</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Your personalized experience</h1>
        <p className="text-sm text-zinc-500 mt-1 font-mono break-all">{externalUserId}</p>
      </div>

      {error && (
        <div className="mb-6 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-3">
          {error}
        </div>
      )}

      {/* Status banner while waiting */}
      {!hasTwin && !error && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
          <Spinner />
          <div>
            <div className="font-medium text-sm text-amber-800">Building your digital twin…</div>
            <p className="text-xs text-amber-600 mt-0.5">
              Analysing your Amazon purchase history to create a shopper profile. This takes about
              30–60 seconds.{attempts > 0 && ` (checked ${attempts}×)`}
            </p>
          </div>
        </div>
      )}

      {hasTwin && !hasPreset && (
        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4 flex items-start gap-3">
          <Spinner />
          <div>
            <div className="font-medium text-sm text-blue-800">Twin minted — matching you to a layout…</div>
            <p className="text-xs text-blue-600 mt-0.5">
              The swarm is voting on which homepage variant fits your style. Almost there.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.6fr] gap-5">
        {/* Left column: twin profile */}
        <div className="flex flex-col gap-4">
          {/* Twin card */}
          <section className="rounded-xl border border-zinc-200 bg-white p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-zinc-100 flex items-center justify-center text-lg">
                🧬
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-zinc-400">Digital twin</div>
                <div className="font-semibold text-sm">
                  {data?.twin?.display_name ?? <GrayBar w="w-36" />}
                </div>
              </div>
            </div>

            <dl className="space-y-3">
              <Row
                label="Transactions analysed"
                value={data?.twin?.raw_txn_count != null ? `${data.twin.raw_txn_count}` : null}
              />
              <Row
                label="Price sensitivity"
                value={data?.twin?.price_sensitivity_hint ?? null}
              />
              <Row
                label="Twin created"
                value={
                  data?.twin?.created_at
                    ? new Date(data.twin.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })
                    : null
                }
              />
            </dl>
          </section>

          {/* Preset assignment card */}
          <section className="rounded-xl border border-zinc-200 bg-white p-5">
            <div className="text-xs uppercase tracking-wider text-zinc-400 mb-3">
              Assigned layout
            </div>
            {hasPreset ? (
              <>
                <div className="font-semibold text-base mb-1">{data!.preset!.display_name}</div>
                {data!.preset!.description && (
                  <p className="text-sm text-zinc-600 leading-relaxed">
                    {data!.preset!.description}
                  </p>
                )}
                {data!.assignment?.score_0_10 != null && (
                  <div className="mt-3">
                    <div className="text-xs text-zinc-400 mb-1">
                      Fit score — {data!.assignment.score_0_10.toFixed(1)} / 10
                    </div>
                    <div className="h-1.5 bg-zinc-100 rounded overflow-hidden">
                      <div
                        className="h-full bg-zinc-800 transition-all duration-700"
                        style={{ width: `${(data!.assignment.score_0_10 / 10) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
                {data!.assignment?.reasoning && (
                  <p className="text-xs text-zinc-400 mt-3 italic leading-relaxed">
                    "{data!.assignment.reasoning}"
                  </p>
                )}
              </>
            ) : (
              <div className="space-y-2">
                <GrayBar w="w-32" />
                <GrayBar w="w-48" h="h-3" />
                <GrayBar w="w-40" h="h-3" />
              </div>
            )}
          </section>

          {/* Persona summary (collapsible) */}
          {data?.twin?.persona_doc && (
            <details className="rounded-xl border border-zinc-200 bg-white group">
              <summary className="p-4 text-sm font-medium cursor-pointer text-zinc-700 list-none flex items-center justify-between select-none">
                <span>Shopper persona</span>
                <span className="text-zinc-400 text-xs group-open:rotate-180 transition-transform">▾</span>
              </summary>
              <div className="px-4 pb-4 text-xs text-zinc-600 leading-relaxed whitespace-pre-wrap border-t border-zinc-100 pt-3">
                {data.twin.persona_doc.slice(0, 800)}
                {data.twin.persona_doc.length > 800 && "…"}
              </div>
            </details>
          )}
        </div>

        {/* Right column: live preset preview */}
        <section className="rounded-xl border border-zinc-200 bg-white overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between">
            <div className="text-xs font-medium text-zinc-500">
              {hasPreset ? `Preview — ${data!.preset!.display_name}` : "Awaiting layout…"}
            </div>
            {hasPreset && (
              <span className="text-[10px] font-mono text-zinc-400">
                {data!.preset!.generated_html.length}B html · {data!.preset!.generated_css.length}B css
              </span>
            )}
          </div>
          {hasPreset ? (
            <PresetFrame preset={data!.preset!} />
          ) : (
            <div className="flex-1 flex items-center justify-center min-h-80">
              <div className="text-center text-zinc-400 text-sm">
                <div className="text-3xl mb-3">🎨</div>
                <div>Your personalised homepage is being prepared…</div>
              </div>
            </div>
          )}
        </section>
      </div>
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
    [preset.id] // only re-render if preset changes, not on every re-fetch
  );
  return (
    <iframe
      srcDoc={doc}
      sandbox="allow-same-origin"
      className="w-full flex-1"
      style={{ height: 560, border: 0, display: "block" }}
      title={preset.display_name}
    />
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-zinc-400 shrink-0">{label}</dt>
      <dd className="text-xs font-medium text-zinc-700 text-right">
        {value ?? <GrayBar w="w-20" />}
      </dd>
    </div>
  );
}

function GrayBar({ w = "w-24", h = "h-3.5" }: { w?: string; h?: string }) {
  return <span className={`inline-block ${w} ${h} bg-zinc-100 rounded animate-pulse`} />;
}

function Spinner() {
  return (
    <svg
      className="w-4 h-4 animate-spin text-current shrink-0 mt-0.5"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v8H4z"
      />
    </svg>
  );
}
