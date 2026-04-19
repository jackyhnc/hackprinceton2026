"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

// Key written by the Shopify Liquid block after Amazon link
const STORAGE_KEY = "amz_external_user_id";

export default function ShopperLanding() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"checking" | "redirect" | "not-found">("checking");
  const [inputId, setInputId] = useState("");

  useEffect(() => {
    // 1. Check URL query param first (e.g. ?id=twinstore-abc123)
    const queryId = searchParams.get("id") || searchParams.get("external_user_id");
    if (queryId) {
      localStorage.setItem(STORAGE_KEY, queryId);
      router.replace(`/shopper/${queryId}`);
      return;
    }

    // 2. Fall back to localStorage
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setStatus("redirect");
      router.replace(`/shopper/${stored}`);
      return;
    }

    setStatus("not-found");
  }, [router, searchParams]);

  if (status === "checking" || status === "redirect") {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="text-3xl mb-3">🧬</div>
          <p className="text-sm text-zinc-500">Loading your profile…</p>
        </div>
      </div>
    );
  }

  // No ID found — show manual entry form
  return (
    <div className="flex-1 flex items-center justify-center px-6">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="text-4xl mb-4">🧬</div>
          <h1 className="text-2xl font-semibold tracking-tight">Your shopper profile</h1>
          <p className="text-sm text-zinc-500 mt-2">
            Link your Amazon account in the store first to build your digital twin.
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-6">
          <div className="mb-4">
            <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider block mb-2">
              External user ID
            </label>
            <input
              type="text"
              value={inputId}
              onChange={(e) => setInputId(e.target.value)}
              placeholder="twinstore-abc123…"
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
            />
          </div>
          <button
            onClick={() => {
              if (!inputId.trim()) return;
              localStorage.setItem(STORAGE_KEY, inputId.trim());
              router.push(`/shopper/${inputId.trim()}`);
            }}
            className="w-full rounded-lg bg-zinc-900 text-white text-sm font-medium py-2.5 hover:bg-zinc-700 transition"
          >
            View my profile →
          </button>
        </div>

        <p className="text-center text-xs text-zinc-400 mt-4">
          Don&apos;t have an ID?{" "}
          <a
            href="http://localhost:3000"
            className="underline hover:text-zinc-600"
            target="_blank"
            rel="noopener noreferrer"
          >
            Visit the store
          </a>{" "}
          and link your Amazon account.
        </p>

        <div className="mt-6 text-center">
          <Link href="/" className="text-xs text-zinc-400 hover:text-zinc-600">
            ← Back to merchant dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
