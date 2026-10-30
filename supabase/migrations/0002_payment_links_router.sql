-- Forward-only compatibility for databases where 0001 was applied before router
-- support. CREATE TABLE IF NOT EXISTS in 0001 does not add missing columns.
-- Assumes the other tables, columns, keys and RLS from 0001 already exist.
-- Existing rows remain direct-transfer links (router NULL); no backfill or deletion.
begin;
alter table public.payment_links add column if not exists router text;
-- Fail rather than silently accepting an incompatible existing router column.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payment_links'
      and column_name = 'router' and data_type = 'text' and is_nullable = 'YES'
  ) then
    raise exception 'payment_links.router must be nullable text; inspect existing schema';
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
