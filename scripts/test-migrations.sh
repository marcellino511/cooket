#!/usr/bin/env bash
# Disposable local PostgreSQL only; no environment database URL or Supabase credentials are read.
set -euo pipefail
pg_bin="$(pg_config --bindir)"
task_pg_dir="$(mktemp -d /tmp/cooket-pg.XXXXXX)"
cleanup() {
  "$pg_bin/pg_ctl" -D "$task_pg_dir/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf -- "$task_pg_dir"
}
trap cleanup EXIT
# Prevent inherited libpq settings from redirecting these local-only connections.
unset PGHOSTADDR PGSERVICE PGSERVICEFILE PGOPTIONS PGPASSWORD
export PGHOST="$task_pg_dir" PGPORT=5432 PGUSER="$(id -un)" PGDATABASE=postgres PGSSLMODE=disable
"$pg_bin/initdb" -D "$task_pg_dir/data" -A trust --no-locale >"$task_pg_dir/init.log"
"$pg_bin/pg_ctl" -D "$task_pg_dir/data" -l "$task_pg_dir/server.log" -o "-F -k $task_pg_dir -c listen_addresses=''" -w start >/dev/null
psql -X -v ON_ERROR_STOP=1 -q -c 'create role anon; create role authenticated;'
for scenario in fresh current legacy; do
  createdb "fixture_$scenario"
  export PGDATABASE="fixture_$scenario"
  if [ "$scenario" = legacy ]; then
    sed '/^  router      text,/d' supabase/migrations/0001_payment_links.sql >"$task_pg_dir/legacy.sql"
    psql -X -v ON_ERROR_STOP=1 -q -f "$task_pg_dir/legacy.sql"
  else
    psql -X -v ON_ERROR_STOP=1 -q -f supabase/migrations/0001_payment_links.sql
  fi
  psql -X -v ON_ERROR_STOP=1 -q <<'SQL'
create table public.legacy_receipts (id text primary key, note text);
insert into public.legacy_receipts values ('keep', 'untouched');
insert into public.payment_links (id, owner_did, recipient, description, mode, amount_raw, created_at)
values ('existing', 'did:fixture', 'recipient', 'Existing data', 'fixed', '2500000', 1000);
insert into public.link_payments values ('existing', '0x' || repeat('a',64), 1, 'payer', '2500000', '10', 2000, 3000);
insert into public.used_nonces values ('existing-nonce', 1000);
SQL
  if [ "$scenario" = current ]; then
    psql -X -v ON_ERROR_STOP=1 -q -c "update public.payment_links set router = 'existing-router';"
  fi
  psql -X -v ON_ERROR_STOP=1 -q -f supabase/migrations/0002_payment_links_router.sql
  psql -X -v ON_ERROR_STOP=1 -q -f supabase/migrations/0002_payment_links_router.sql
  psql -X -v ON_ERROR_STOP=1 -q -v scenario="$scenario" <<'SQL'
select set_config('fixture.scenario', :'scenario', false) as scenario;
do $$
begin
  if (select count(*) from public.payment_links) <> 1 or
     (select description from public.payment_links where id='existing') <> 'Existing data' or
     (select amount_raw from public.link_payments where link_id='existing') <> '2500000' or
     (select count(*) from public.used_nonces) <> 1 or
     (select note from public.legacy_receipts where id='keep') <> 'untouched' then
    raise exception 'Existing data was changed';
  end if;
  if current_setting('fixture.scenario') = 'current' then
    if (select router from public.payment_links where id='existing') <> 'existing-router' then
      raise exception 'Router changed';
    end if;
  elsif (select router from public.payment_links where id='existing') is not null then
    raise exception 'Legacy row was bound to a router';
  end if;
  begin
    insert into public.used_nonces values ('existing-nonce', 2000);
    raise exception 'Nonce replay accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into public.link_payments select * from public.link_payments;
    raise exception 'Payment replay accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into public.link_payments values ('missing', '0x' || repeat('b',64), 2, 'payer', '1', '11', 2000, 3000);
    raise exception 'Invalid link accepted';
  exception when foreign_key_violation then null;
  end;
  if exists (select 1 from pg_class where oid in ('public.payment_links'::regclass, 'public.link_payments'::regclass, 'public.used_nonces'::regclass) and not relrowsecurity) then
    raise exception 'RLS missing';
  end if;
  if has_table_privilege('anon', 'public.payment_links', 'SELECT') or
     has_table_privilege('authenticated', 'public.link_payments', 'INSERT') then
    raise exception 'Public privileges present';
  end if;
end $$;
SQL
  echo "PASS  $scenario schema: repeatable migration, preserved data, nonce/payment uniqueness, FK and RLS"
  export PGDATABASE=postgres
done
createdb fixture_incompatible
export PGDATABASE=fixture_incompatible
psql -X -v ON_ERROR_STOP=1 -q -c 'create table public.payment_links (id text primary key, router integer);'
if psql -X -v ON_ERROR_STOP=1 -q -f supabase/migrations/0002_payment_links_router.sql >"$task_pg_dir/rejection.log" 2>&1; then
  echo 'FAIL  incompatible router type was accepted' >&2
  exit 1
fi
[ "$(psql -X -At -c "select data_type from information_schema.columns where table_schema='public' and table_name='payment_links' and column_name='router'")" = integer ]
echo 'PASS  incompatible existing column rejected without changing its type'
