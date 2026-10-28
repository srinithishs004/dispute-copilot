alter table disputes add column original_amount numeric(10,2);
update disputes set original_amount = amount where original_amount is null;
alter table disputes add column deadline_flag text check (deadline_flag in ('due_soon', 'overdue'));
