-- TwinStore schema v2: pgvector, merchants, cross-store twin linking, preset library.
-- Run in the Supabase SQL editor after 0001_init.sql.

create extension if not exists vector;

-- Amend twins from v1: embedding for pgvector lookup, price sensitivity for discount engine.
alter table twins add column if not exists embedding vector(1536);
alter table twins add column if not exists price_sensitivity_hint text
    check (price_sensitivity_hint in ('low', 'mid', 'high'));

create index if not exists twins_embedding_idx
    on twins using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create table if not exists merchants (
    id uuid primary key default gen_random_uuid(),
    shop text unique not null,
    admin_token text,
    installed_at timestamptz not null default now(),
    discount_config jsonb not null default
        '{"enabled": true, "max_pct": 15, "daily_budget_cents": 10000, "cooldown_minutes": 60}'::jsonb
);

create table if not exists customer_twin_link (
    merchant_id uuid not null references merchants(id) on delete cascade,
    shopify_customer_id text not null,
    twin_id uuid not null references twins(id) on delete cascade,
    linked_at timestamptz not null default now(),
    primary key (merchant_id, shopify_customer_id)
);

create index if not exists customer_twin_link_twin_idx on customer_twin_link(twin_id);

create table if not exists preset_library (
    id text primary key,
    display_name text not null,
    description text not null,
    config jsonb not null,
    created_at timestamptz not null default now()
);

create table if not exists twin_preset_assignments (
    twin_id uuid not null references twins(id) on delete cascade,
    merchant_id uuid not null references merchants(id) on delete cascade,
    preset_id text not null references preset_library(id),
    score_0_10 numeric,
    reasoning text,
    run_id uuid references swarm_runs(id) on delete set null,
    assigned_at timestamptz not null default now(),
    primary key (twin_id, merchant_id)
);

create index if not exists tpa_merchant_idx on twin_preset_assignments(merchant_id);

-- swarm_runs.product_id becomes optional (mini/full swarm runs are not product-scoped).
alter table swarm_runs alter column product_id drop not null;
alter table swarm_runs add column if not exists kind text
    check (kind in ('mini', 'full', 'product')) default 'full';
alter table swarm_runs add column if not exists merchant_id uuid references merchants(id) on delete cascade;

-- Seed 4 presets. Selectors target Shopify Dawn theme (default dev-store theme).
insert into preset_library (id, display_name, description, config) values
(
    'minimal',
    'Minimal',
    'Clean, editorial, low visual noise. Fits shoppers who value product quality over deals; reads as calm and considered. Neutral palette, restrained CTAs, no urgency tactics.',
    jsonb_build_object(
        'id', 'minimal',
        'display_name', 'Minimal',
        'description', 'Clean editorial layout, neutral palette, no urgency.',
        'transforms', jsonb_build_array(
            jsonb_build_object('op', 'addClass', 'selector', 'body', 'className', 'twinstore-preset-minimal'),
            jsonb_build_object('op', 'hide', 'selector', '.card__badge, .product-card__badge, .badge--bottom-left')
        ),
        'overrides', jsonb_build_object(
            'hero_title', 'Made to last.',
            'cta_primary', 'Explore'
        ),
        'css_vars', jsonb_build_object(
            '--twinstore-primary', '#111111',
            '--twinstore-accent', '#666666',
            '--twinstore-bg', '#fafaf7'
        )
    )
),
(
    'vibrant',
    'Vibrant',
    'Bold colors, loud CTAs, clear urgency cues. Fits impulsive shoppers who respond to energy and novelty. High-contrast palette, bigger badges, punchier copy.',
    jsonb_build_object(
        'id', 'vibrant',
        'display_name', 'Vibrant',
        'description', 'Bold high-contrast palette, urgent CTAs, prominent badges.',
        'transforms', jsonb_build_array(
            jsonb_build_object('op', 'addClass', 'selector', 'body', 'className', 'twinstore-preset-vibrant'),
            jsonb_build_object('op', 'show', 'selector', '.card__badge, .product-card__badge')
        ),
        'overrides', jsonb_build_object(
            'hero_title', 'New drops. Right now.',
            'cta_primary', 'Shop the drop',
            'product_card_badge', 'Hot'
        ),
        'css_vars', jsonb_build_object(
            '--twinstore-primary', '#f43f5e',
            '--twinstore-accent', '#facc15',
            '--twinstore-bg', '#ffffff'
        )
    )
),
(
    'value-hunter',
    'Value Hunter',
    'Discount-first framing. Fits price-sensitive shoppers who compare and wait for deals. Sale badges prominent, savings emphasized in copy, CTA frames the offer.',
    jsonb_build_object(
        'id', 'value-hunter',
        'display_name', 'Value Hunter',
        'description', 'Discount-forward copy, visible sale badges, savings emphasis.',
        'transforms', jsonb_build_array(
            jsonb_build_object('op', 'addClass', 'selector', 'body', 'className', 'twinstore-preset-value'),
            jsonb_build_object('op', 'show', 'selector', '.card__badge, .product-card__badge, .price--on-sale')
        ),
        'overrides', jsonb_build_object(
            'hero_title', 'Smarter prices, every day.',
            'cta_primary', 'See today''s deals',
            'product_card_badge', 'Save'
        ),
        'css_vars', jsonb_build_object(
            '--twinstore-primary', '#16a34a',
            '--twinstore-accent', '#dc2626',
            '--twinstore-bg', '#ffffff'
        )
    )
),
(
    'luxury',
    'Luxury',
    'Refined, editorial, premium feel. Fits shoppers who skew toward quality/status signaling. Serif display, dark palette with metallic accent, no discount framing, scarcity language only.',
    jsonb_build_object(
        'id', 'luxury',
        'display_name', 'Luxury',
        'description', 'Serif display, dark palette with metallic accent, restrained scarcity.',
        'transforms', jsonb_build_array(
            jsonb_build_object('op', 'addClass', 'selector', 'body', 'className', 'twinstore-preset-luxury'),
            jsonb_build_object('op', 'hide', 'selector', '.price--on-sale, .badge--sale')
        ),
        'overrides', jsonb_build_object(
            'hero_title', 'Quiet luxury, considered.',
            'cta_primary', 'Discover the collection',
            'product_card_badge', 'Limited'
        ),
        'css_vars', jsonb_build_object(
            '--twinstore-primary', '#0a0a0a',
            '--twinstore-accent', '#b08d57',
            '--twinstore-bg', '#0f0f0f',
            '--twinstore-text', '#f5f1ea'
        )
    )
)
on conflict (id) do update
    set display_name = excluded.display_name,
        description = excluded.description,
        config = excluded.config;

-- Seed a demo merchant row so twin_preset_assignments has a FK target for local dev.
-- Replace the shop handle with your dev store if different.
insert into merchants (shop)
values ('test-1111111111111111111111111111111111711111111111123891.myshopify.com')
on conflict (shop) do nothing;
