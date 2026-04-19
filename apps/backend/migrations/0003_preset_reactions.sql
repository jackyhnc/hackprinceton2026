-- M5: per-(run, twin, preset) score rows. twin_preset_assignments stores
-- only the winning preset per twin; this table stores the full score matrix
-- the swarm computed so the dashboard can show reasoning across all presets.

create table if not exists preset_reactions (
    id bigserial primary key,
    run_id uuid not null references swarm_runs(id) on delete cascade,
    twin_id uuid not null references twins(id) on delete cascade,
    preset_id text not null references preset_library(id),
    score_0_10 numeric not null,
    reasoning text,
    created_at timestamptz not null default now()
);

create index if not exists preset_reactions_run_idx on preset_reactions(run_id);
create index if not exists preset_reactions_twin_idx on preset_reactions(twin_id);
create unique index if not exists preset_reactions_uq on preset_reactions(run_id, twin_id, preset_id);
