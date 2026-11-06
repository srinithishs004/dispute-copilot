-- Sandbox carrier: simulated parcel tracking so every demo order gets delivery proof
-- (or proof of non-delivery). Additive only; existing rows keep working.
alter table orders add column if not exists delivery_sim text not null default 'DELIVERED'
  check (delivery_sim in ('DELIVERED', 'LOST'));
alter table shipments add column if not exists simulated boolean not null default false;
alter table shipments add column if not exists sim_scenario text not null default 'DELIVERED'
  check (sim_scenario in ('DELIVERED', 'LOST'));
alter table shipments add column if not exists delivered_to text;
alter table shipments add column if not exists signed_by text;

create table if not exists tracking_events (
  id serial primary key,
  shipment_id integer not null references shipments(id) on delete cascade,
  status text not null,
  description text not null,
  location text,
  occurred_at timestamptz not null,
  unique (shipment_id, status)
);
create index if not exists tracking_events_shipment_idx on tracking_events (shipment_id, occurred_at);
