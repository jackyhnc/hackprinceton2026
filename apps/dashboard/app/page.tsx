"use client";

import { useEffect, useState } from "react";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

export default function Home() {
  const [health, setHealth] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${BACKEND}/health`)
      .then((r) => r.json())
      .then(setHealth)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <main className="min-h-screen p-12">
      <h1 className="text-3xl font-semibold mb-2">TwinStore</h1>
      <p className="text-gray-500 mb-8">Merchant dashboard</p>

      <section className="rounded border border-gray-200 p-6 max-w-xl">
        <h2 className="text-lg font-medium mb-2">Backend status</h2>
        {error !== null && <pre className="text-red-600 text-sm">{error}</pre>}
        {health !== null && (
          <pre className="text-sm bg-gray-50 p-3 rounded">
            {JSON.stringify(health, null, 2)}
          </pre>
        )}
        {health === null && error === null && (
          <p className="text-gray-400">Checking…</p>
        )}
      </section>
    </main>
  );
}
