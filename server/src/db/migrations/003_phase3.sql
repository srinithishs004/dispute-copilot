alter table disputes add column original_amount numeric(10,2);
-- PayPal lowers dispute_amount after an accepted offer, so prefer the original transaction amount from raw.
update disputes set original_amount = coalesce(
  case when raw->'disputed_transactions'->0->'gross_amount'->>'value' ~ '^[0-9]+(\.[0-9]+)?$'
       then (raw->'disputed_transactions'->0->'gross_amount'->>'value')::numeric end,
  amount)
where original_amount is null;
alter table disputes add column deadline_flag text check (deadline_flag in ('due_soon', 'overdue'));
