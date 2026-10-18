alter table analyses add column flags jsonb not null default '[]';
alter table actions add column created_at timestamptz not null default now();
create unique index actions_one_open_per_dispute on actions (dispute_id) where state = 'PENDING';
