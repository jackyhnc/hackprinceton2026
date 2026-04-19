-- TwinStore initial schema. Run in the Supabase SQL editor (or via supabase db push).

create extension if not exists "pgcrypto";

create table if not exists twins (
    id uuid primary key default gen_random_uuid(),
    source_session_id text,
    source_merchant text,
    raw_txn_count int not null default 0,
    persona_doc text not null,
    raw_summary jsonb not null default '{}'::jsonb,
    display_name text,
    created_at timestamptz not null default now()
);

create index if not exists twins_session_idx on twins(source_session_id);

create table if not exists products (
    id uuid primary key default gen_random_uuid(),
    shopify_product_id text,
    title text not null,
    description text,
    price_cents int,
    image_url text,
    category text,
    raw jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create table if not exists swarm_runs (
    id uuid primary key default gen_random_uuid(),
    product_id uuid not null references products(id) on delete cascade,
    twin_ids uuid[] not null,
    status text not null default 'pending',
    error text,
    started_at timestamptz not null default now(),
    finished_at timestamptz
);

create index if not exists swarm_runs_status_idx on swarm_runs(status);

create table if not exists reactions (
    id bigserial primary key,
    run_id uuid not null references swarm_runs(id) on delete cascade,
    twin_id uuid not null references twins(id) on delete cascade,
    verdict text not null check (verdict in ('buy', 'maybe', 'no')),
    would_pay_max_cents int,
    top_reason text,
    sample_quote text,
    segment_tag text,
    raw_json jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists reactions_run_id_idx on reactions(run_id, id);

create table if not exists actions (
    id uuid primary key default gen_random_uuid(),
    run_id uuid not null references swarm_runs(id) on delete cascade,
    type text not null check (type in ('set_price', 'create_discount', 'rewrite_copy', 'launch', 'kill', 'delay')),
    params jsonb not null,
    evidence jsonb not null default '{}'::jsonb,
    status text not null default 'proposed' check (status in ('proposed', 'approved', 'applied', 'rejected')),
    applied_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists actions_run_id_idx on actions(run_id);
