# TwinStore — HackPrinceton 2026

Shopify app for store owners. Runs an "agent swarm" of digital-twin shoppers
(synthesized from real Amazon-style purchase histories via KnotAPI) against new
products, and produces structured actions (set price, create discount, rewrite
copy) the merchant can one-click push back to their Shopify store.

Plan: see [`/Users/jackyhanc/.claude/plans/plan-this-out-gentle-toast.md`](/Users/jackyhanc/.claude/plans/plan-this-out-gentle-toast.md).

## Layout

```
apps/
  backend/             FastAPI service — twin minting, swarm dispatch, Shopify write-back
  dashboard/           Next.js 16 merchant dashboard
  checkout-extension/  Shopify Checkout UI Extension + knotapi-js
packages/
  shared/              Shared TS types
  prompts/             LLM prompt templates (twin synthesis, reaction, consolidator)
containers/
  swarm-runner/        Dedalus container — fans out per-twin reactions to K2 Think V2
seed/twins/            Pre-generated synthetic twin library
design/enter-pro/      Enter Pro mockup exports
```

## Prerequisites

- Node 20+, pnpm 9+
- Python 3.11+, [uv](https://docs.astral.sh/uv/)
- Supabase project (free tier)
- API keys: KnotAPI, K2 Think V2, Dedalus, Shopify dev store

## Setup

1. `cp .env.example .env` and fill in the keys.
2. **Supabase:** create a project, then in the SQL editor paste
   `apps/backend/migrations/0001_init.sql` and run.
3. **Backend:**
   ```sh
   cd apps/backend
   uv sync
   uv run uvicorn main:app --reload --port 8000
   ```
   Verify at <http://localhost:8000/health>.
4. **Dashboard:**
   ```sh
   cd apps/dashboard
   pnpm install   # one-time, run from repo root next time
   pnpm dev
   ```
   Open <http://localhost:3000>; the home page should show the backend health JSON.
5. **Swarm runner:** wired up in M4. For now: `python containers/swarm-runner/runner.py < /dev/null`.

## Sponsor tracks

- **KnotAPI** — `apps/backend` + `apps/checkout-extension`
- **K2 Think V2** — `containers/swarm-runner` + `apps/backend` (twin synthesis)
- **Enter Pro** — `design/enter-pro/` (mockups) → `apps/dashboard` (impl)
- **Dedalus Containers** — `containers/swarm-runner`
