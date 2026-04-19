"use client";

import { FormEvent, useEffect, useState } from "react";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

type DashboardData = {
  merchant: {
    id: string;
    shop: string;
    installed_at: string;
    discount_config: DiscountPolicy;
  };
  overview: {
    linked_user_count: number;
    assigned_twin_count: number;
    preset_count: number;
    run_count: number;
  };
  recent_runs: {
    id: string;
    kind: string;
    status: string;
    started_at: string | null;
    finished_at: string | null;
    error?: string | null;
  }[];
  recent_users: {
    shopify_customer_id: string;
    linked_at: string;
    twin: {
      id: string;
      display_name?: string;
      raw_txn_count?: number;
      price_sensitivity_hint?: string;
    };
  }[];
  presets: {
    id: string;
    display_name: string;
    description: string;
    change_summary?: string | null;
    voter_twin_ids?: string[] | null;
  }[];
};

type DiscountPolicy = {
  enabled: boolean;
  max_pct: number;
  daily_budget_cents: number;
  cooldown_minutes: number;
};

const defaultPolicy: DiscountPolicy = {
  enabled: true,
  max_pct: 15,
  daily_budget_cents: 10000,
  cooldown_minutes: 60,
};

function formatDate(value?: string | null) {
  if (!value) return "Not yet";
  return new Date(value).toLocaleString();
}

function statusTone(status: string) {
  switch (status) {
    case "completed":
      return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "running":
      return "bg-blue-50 text-blue-800 border-blue-200";
    case "failed":
      return "bg-red-50 text-red-800 border-red-200";
    default:
      return "bg-stone-100 text-stone-700 border-stone-200";
  }
}

export default function Home() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [policy, setPolicy] = useState<DiscountPolicy>(defaultPolicy);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );

  async function loadDashboard() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${BACKEND}/dashboard/overview`, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`dashboard request failed: ${response.status}`);
      }

      const payload: DashboardData = await response.json();
      setData(payload);
      setPolicy(payload.merchant.discount_config ?? defaultPolicy);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function loadInitialDashboard() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`${BACKEND}/dashboard/overview`, {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`dashboard request failed: ${response.status}`);
        }

        const payload: DashboardData = await response.json();
        setData(payload);
        setPolicy(payload.merchant.discount_config ?? defaultPolicy);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }

    void loadInitialDashboard();
  }, []);

  async function onSavePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveState("saving");

    try {
      const response = await fetch(`${BACKEND}/dashboard/discount-policy`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(policy),
      });

      if (!response.ok) {
        throw new Error(`discount update failed: ${response.status}`);
      }

      setSaveState("saved");
      await loadDashboard();
      window.setTimeout(() => setSaveState("idle"), 1600);
    } catch {
      setSaveState("error");
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-6 py-10 md:px-10">
      <section className="mb-8 flex flex-col gap-4 border-b border-[var(--line)] pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
            KnotMyShop
          </div>
          <h1 className="mt-2 font-[family-name:var(--font-newsreader)] text-3xl leading-tight tracking-[-0.03em]">
            Owner dashboard
          </h1>
        </div>
        <div className="text-sm text-[var(--muted)] md:text-right">
          <div className="font-medium text-[var(--foreground)]">
            {data?.merchant.shop ?? "No merchant connected"}
          </div>
          <div>FastAPI source of truth</div>
        </div>
      </section>

      {loading && (
        <section className="rounded-[24px] border border-[var(--line)] bg-[var(--panel)] px-6 py-10 text-[var(--muted)]">
          Loading dashboard...
        </section>
      )}

      {error && (
        <section className="rounded-[24px] border border-red-200 bg-red-50 px-6 py-5 text-red-700">
          {error}
        </section>
      )}

      {data && !loading && !error && (
        <>
          <section className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Knot-linked users"
              value={data.overview.linked_user_count}
              note="Storefront visitors who linked and became known users"
            />
            <MetricCard
              label="Assigned twins"
              value={data.overview.assigned_twin_count}
              note="Users routed to one of the generated presets"
            />
            <MetricCard
              label="Generated presets"
              value={data.overview.preset_count}
              note="Current preset variants available to the storefront"
            />
            <MetricCard
              label="Swarm runs"
              value={data.overview.run_count}
              note="Total recorded mini and full runs"
            />
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-6">
              <Card
                eyebrow="recent Knot users"
                title="People who entered through the personalization flow"
                subtitle="Keep this tight for the demo. You mainly need evidence that real linked users became twins and got assigned a route."
              >
                <div className="space-y-3">
                  {data.recent_users.length === 0 && (
                    <EmptyState text="No linked users yet." />
                  )}
                  {data.recent_users.map((user) => (
                    <div
                      key={`${user.shopify_customer_id}-${user.linked_at}`}
                      className="grid gap-3 rounded-2xl border border-[var(--line)] bg-[var(--panel-strong)] p-4 md:grid-cols-[1.2fr_0.8fr_auto]"
                    >
                      <div>
                        <div className="text-sm text-[var(--muted)]">
                          customer id
                        </div>
                        <div className="mt-1 font-medium text-[var(--foreground)]">
                          {user.shopify_customer_id}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-[var(--muted)]">twin</div>
                        <div className="mt-1 font-medium text-[var(--foreground)]">
                          {user.twin.display_name ?? user.twin.id}
                        </div>
                        <div className="mt-1 text-sm text-[var(--muted)]">
                          {user.twin.raw_txn_count ?? 0} txns ·{" "}
                          {user.twin.price_sensitivity_hint ?? "unknown"} price sensitivity
                        </div>
                      </div>
                      <div className="text-sm text-[var(--muted)] md:text-right">
                        {formatDate(user.linked_at)}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card
                eyebrow="generated presets"
                title="Preset outputs from the current swarm"
                subtitle="This is the output that actually changes the storefront. Each card is one generated route."
              >
                <div className="grid gap-4 md:grid-cols-2">
                  {data.presets.length === 0 && (
                    <EmptyState text="No presets generated yet." />
                  )}
                  {data.presets.map((preset) => (
                    <article
                      key={preset.id}
                      className="rounded-[22px] border border-[var(--line)] bg-[var(--panel-strong)] p-5"
                    >
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <h3 className="font-[family-name:var(--font-newsreader)] text-2xl leading-tight">
                            {preset.display_name}
                          </h3>
                          <p className="mt-1 text-sm text-[var(--muted)]">
                            {preset.description}
                          </p>
                        </div>
                        <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-medium text-[var(--accent)]">
                          {preset.voter_twin_ids?.length ?? 0} voters
                        </span>
                      </div>
                      <pre className="overflow-x-auto whitespace-pre-wrap rounded-2xl bg-[#f3f1ec] p-4 text-sm leading-6 text-[var(--foreground)]">
                        {preset.change_summary ?? "No summary yet."}
                      </pre>
                    </article>
                  ))}
                </div>
              </Card>
            </div>

            <div className="space-y-6">
              <Card
                eyebrow="discount controls"
                title="Owner-configured limits"
                subtitle="This writes straight to the merchant discount config in the backend."
              >
                <form className="space-y-4" onSubmit={onSavePolicy}>
                  <label className="flex items-center justify-between rounded-2xl border border-[var(--line)] bg-[var(--panel-strong)] px-4 py-3">
                    <span>
                      <div className="font-medium">Discounts enabled</div>
                      <div className="text-sm text-[var(--muted)]">
                        Turn incentive offers on or off
                      </div>
                    </span>
                    <input
                      type="checkbox"
                      checked={policy.enabled}
                      onChange={(event) =>
                        setPolicy((current) => ({
                          ...current,
                          enabled: event.target.checked,
                        }))
                      }
                    />
                  </label>

                  <PolicyNumberField
                    label="Maximum discount percent"
                    value={policy.max_pct}
                    suffix="%"
                    onChange={(value) =>
                      setPolicy((current) => ({ ...current, max_pct: value }))
                    }
                  />
                  <PolicyNumberField
                    label="Daily budget"
                    value={policy.daily_budget_cents}
                    suffix="cents"
                    onChange={(value) =>
                      setPolicy((current) => ({
                        ...current,
                        daily_budget_cents: value,
                      }))
                    }
                  />
                  <PolicyNumberField
                    label="Cooldown window"
                    value={policy.cooldown_minutes}
                    suffix="mins"
                    onChange={(value) =>
                      setPolicy((current) => ({
                        ...current,
                        cooldown_minutes: value,
                      }))
                    }
                  />

                  <button
                    type="submit"
                    className="w-full rounded-2xl bg-[var(--foreground)] px-4 py-3 text-sm font-medium text-white transition hover:opacity-92"
                  >
                    {saveState === "saving" ? "Saving..." : "Save discount policy"}
                  </button>

                  {saveState === "saved" && (
                    <p className="text-sm text-[var(--success)]">
                      Discount policy updated.
                    </p>
                  )}
                  {saveState === "error" && (
                    <p className="text-sm text-red-600">
                      Could not save the discount policy.
                    </p>
                  )}
                </form>
              </Card>

              <Card
                eyebrow="swarm activity"
                title="Recent runs"
                subtitle="Enough visibility to rerun or debug later without drowning the owner in raw logs."
              >
                <div className="space-y-3">
                  {data.recent_runs.length === 0 && (
                    <EmptyState text="No swarm runs yet." />
                  )}
                  {data.recent_runs.map((run) => (
                    <div
                      key={run.id}
                      className="rounded-2xl border border-[var(--line)] bg-[var(--panel-strong)] p-4"
                    >
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
                            {run.kind} run
                          </div>
                          <div className="font-medium">{run.id}</div>
                        </div>
                        <span
                          className={`rounded-full border px-3 py-1 text-xs font-medium ${statusTone(
                            run.status
                          )}`}
                        >
                          {run.status}
                        </span>
                      </div>
                      <div className="space-y-1 text-sm text-[var(--muted)]">
                        <div>Started: {formatDate(run.started_at)}</div>
                        <div>Finished: {formatDate(run.finished_at)}</div>
                        {run.error && (
                          <div className="text-red-600">Error: {run.error}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function MetricCard({
  label,
  value,
  note,
}: {
  label: string;
  value: number;
  note: string;
}) {
  return (
    <article className="rounded-[24px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_10px_30px_rgba(38,35,31,0.05)]">
      <div className="text-sm text-[var(--muted)]">{label}</div>
      <div className="mt-3 font-[family-name:var(--font-newsreader)] text-5xl leading-none tracking-[-0.05em]">
        {value}
      </div>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{note}</p>
    </article>
  );
}

function Card({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[0_12px_40px_rgba(38,35,31,0.05)]">
      <div className="mb-5">
        <div className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
          {eyebrow}
        </div>
        <h2 className="mt-2 font-[family-name:var(--font-newsreader)] text-3xl leading-tight tracking-[-0.03em]">
          {title}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
          {subtitle}
        </p>
      </div>
      {children}
    </section>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--line)] px-4 py-6 text-sm text-[var(--muted)]">
      {text}
    </div>
  );
}

function PolicyNumberField({
  label,
  value,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block rounded-2xl border border-[var(--line)] bg-[var(--panel-strong)] px-4 py-3">
      <div className="mb-2 text-sm text-[var(--muted)]">{label}</div>
      <div className="flex items-center gap-3">
        <input
          className="w-full bg-transparent text-lg outline-none"
          type="number"
          min={0}
          value={value}
          onChange={(event) => onChange(Number(event.target.value || 0))}
        />
        <span className="text-sm text-[var(--muted)]">{suffix}</span>
      </div>
    </label>
  );
}
