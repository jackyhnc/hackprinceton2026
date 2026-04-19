-- 0004: Generated presets via coding-agent pipeline.
--
-- Presets are no longer hard-coded. Each swarm run generates its own preset
-- rows (HTML + CSS synthesized by a K2 "coding agent") and the old rows are
-- wiped. FK cascades to twin_preset_assignments and preset_reactions so
-- re-runs are idempotent.

alter table preset_library
    add column if not exists change_summary text,
    add column if not exists generated_html text,
    add column if not exists generated_css text,
    add column if not exists voter_twin_ids jsonb,
    add column if not exists run_id uuid;

-- Coding-agent presets don't populate the old `config` shape.
alter table preset_library alter column config drop not null;

-- Cascade deletes so a new swarm run can blow away the prior run's presets.
alter table twin_preset_assignments drop constraint if exists twin_preset_assignments_preset_id_fkey;
alter table twin_preset_assignments
    add constraint twin_preset_assignments_preset_id_fkey
    foreign key (preset_id) references preset_library(id) on delete cascade;

alter table preset_reactions drop constraint if exists preset_reactions_preset_id_fkey;
alter table preset_reactions
    add constraint preset_reactions_preset_id_fkey
    foreign key (preset_id) references preset_library(id) on delete cascade;

alter table preset_library drop constraint if exists preset_library_run_id_fkey;
alter table preset_library
    add constraint preset_library_run_id_fkey
    foreign key (run_id) references swarm_runs(id) on delete set null;

create index if not exists preset_library_run_idx on preset_library(run_id);

-- Drop hardcoded seed presets. Swarm generates fresh ones on each run.
delete from preset_library;
