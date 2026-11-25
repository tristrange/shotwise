-- A9 (roadmap §13.4 item 13/14): revision-checked reference deletes and
-- aligned write/restore boundaries.
--  * delete_reference_value now requires the expected revision, like save:
--    a stale tab can no longer delete a newer edit (owner locking alone
--    cannot detect stale intent). The old one-argument function is dropped,
--    so an old client fails loudly instead of deleting without a check.
--  * save enforces the same 1000-row limit that restore enforces, so the
--    database can no longer write a dataset its own restore would reject.
--  * the database boundary now rejects unknown club labels ('?', 'unknown',
--    '--'), matching the form-level validation in benchmarks.ts.
create or replace function private.valid_reference_value(v jsonb) returns boolean language plpgsql immutable set search_path='' as $$ begin
 if not coalesce(jsonb_typeof(v)='object' and jsonb_typeof(v->'id')='string' and lower(v->>'id') ~ '^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$' and jsonb_typeof(v->'club')='string' and length(private.js_trim(v->>'club')) between 1 and 30 and lower(private.js_trim(v->>'club')) not in ('?','unknown','--') and v->>'metric' in ('carry','total') and jsonb_typeof(v->'valueM')='number' and (v->>'valueM') ~ '^[0-9]+(\.[0-9]+)?$' and (v->>'valueM')::numeric>0 and (v->>'valueM')::numeric<=500 and (v->'note'='null'::jsonb or (jsonb_typeof(v->'note')='string' and length(private.js_trim(v->>'note'))<=200)) and jsonb_typeof(v->'revision')='number' and (v->>'revision') ~ '^[0-9]+$' and (v->>'revision')::integer>=0,false) then return false; end if;
 return true; exception when others then return false; end $$;
create or replace function private.save_reference_value(p_value jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ declare u uuid:=private.lock_owner(); existing public.user_reference_values%rowtype; saved jsonb; begin
 if not coalesce(jsonb_typeof(p_value)='object' and jsonb_typeof(p_value->'id')='string' and (p_value->>'id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',false) then raise exception 'Invalid reference value'; end if;
 if p_value->'revision'='null'::jsonb then
  if not private.valid_reference_value(jsonb_set(p_value,'{revision}','0'::jsonb)) then raise exception 'Invalid reference value'; end if;
  if exists(select 1 from public.user_reference_values where owner_id=u and id=(p_value->>'id')::uuid) then raise exception 'Reference value conflict'; end if;
  if exists(select 1 from public.user_reference_values where owner_id=u and (data->>'metric')=p_value->>'metric' and lower(private.js_trim(data->>'club'))=lower(private.js_trim(p_value->>'club'))) then raise exception 'Reference value conflict'; end if;
  if (select count(*) from public.user_reference_values where owner_id=u)>=1000 then raise exception 'Reference value limit reached'; end if;
  saved:=jsonb_set(p_value || jsonb_build_object('id',(p_value->>'id')::uuid,'revision',0),'{club}',to_jsonb(private.js_trim(p_value->>'club')));
  insert into public.user_reference_values values((p_value->>'id')::uuid,u,saved);
 elsif (p_value->>'revision') ~ '^[0-9]+$' and private.valid_reference_value(p_value) then
  select * into existing from public.user_reference_values where owner_id=u and id=(p_value->>'id')::uuid for update;
  if not found or existing.data->>'revision'<>p_value->>'revision' then raise exception 'Reference value conflict'; end if;
  if (p_value->>'revision')::integer=2147483647 then raise exception 'Reference value revision limit reached'; end if;
  saved:=jsonb_set(p_value || jsonb_build_object('id',existing.id,'revision',(p_value->>'revision')::integer+1),'{club}',to_jsonb(private.js_trim(p_value->>'club')));
  update public.user_reference_values set data=saved where owner_id=u and id=existing.id;
 else raise exception 'Invalid reference value'; end if;
 perform private.bump(u);
 return saved;
end $$;
drop function if exists public.delete_reference_value(uuid);
drop function if exists private.delete_reference_value(uuid);
create function private.delete_reference_value(p_id uuid, p_revision integer) returns void language plpgsql security definer set search_path='' as $$ declare u uuid:=private.lock_owner(); existing public.user_reference_values%rowtype; begin
 if p_id is null or p_revision is null or p_revision<0 then raise exception 'Invalid reference value'; end if;
 select * into existing from public.user_reference_values where owner_id=u and id=p_id for update;
 if not found or (existing.data->>'revision')::integer<>p_revision then raise exception 'Reference value conflict'; end if;
 delete from public.user_reference_values where owner_id=u and id=p_id;
 perform private.bump(u);
end $$;
revoke all on function private.valid_reference_value(jsonb),private.save_reference_value(jsonb),private.delete_reference_value(uuid,integer) from public, anon, authenticated;
grant execute on function private.save_reference_value(jsonb),private.delete_reference_value(uuid,integer) to authenticated;
create function public.delete_reference_value(p_id uuid, p_revision integer) returns void language sql security invoker set search_path='' as $$ select private.delete_reference_value(p_id,p_revision) $$;
revoke all on function public.delete_reference_value(uuid,integer) from public, anon;
grant execute on function public.delete_reference_value(uuid,integer) to authenticated;
