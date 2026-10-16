create table orders (
  id text primary key,
  item text,
  amount numeric(10,2),
  currency text,
  buyer_email text,
  paypal_order_id text unique,
  paypal_capture_id text unique,
  status text not null default 'PENDING',
  created_at timestamptz default now()
);

create table shipments (
  id serial primary key,
  order_id text references orders(id),
  carrier text,
  tracking_number text,
  status text,
  shipped_at timestamptz,
  delivered_at timestamptz,
  signature_proof boolean default false
);

create table messages (
  id serial primary key,
  order_id text references orders(id),
  sender text check (sender in ('buyer','seller')),
  body text,
  sent_at timestamptz
);

create table store_policy (
  id int primary key default 1 check (id = 1),
  refund_window_days int,
  policy_text text
);

create table webhook_events (
  paypal_event_id text primary key,
  event_type text,
  resource_id text,
  raw jsonb,
  received_at timestamptz default now(),
  processed_at timestamptz
);

create table disputes (
  paypal_dispute_id text primary key,
  order_id text references orders(id),
  reason text,
  status text,
  stage text,
  amount numeric(10,2),
  currency text,
  response_due_at timestamptz,
  raw jsonb,
  local_state text not null default 'NEW',
  manual_reason text,
  updated_at timestamptz default now()
);

create table evidence_items (
  id serial primary key,
  dispute_id text references disputes(paypal_dispute_id),
  type text,
  description text,
  file_path text
);

create table analyses (
  id serial primary key,
  dispute_id text references disputes(paypal_dispute_id),
  recommendation text,
  confidence int,
  evidence_strength text,
  reasons jsonb,
  missing_evidence jsonb,
  suggested_offer numeric(10,2),
  letter_draft text,
  model_used text,
  created_at timestamptz default now()
);

create table actions (
  id serial primary key,
  dispute_id text references disputes(paypal_dispute_id),
  type text,
  payload jsonb,
  state text,
  paypal_response jsonb,
  error text,
  approved_at timestamptz,
  sent_at timestamptz
);

create table jobs (
  id bigserial primary key,
  type text not null,
  payload jsonb not null,
  state text not null default 'queued' check (state in ('queued','running','done','failed')),
  attempts int not null default 0,
  run_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index jobs_state_run_at_idx on jobs (state, run_at);
