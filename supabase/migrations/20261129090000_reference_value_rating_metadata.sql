-- C1 follow-up (roadmap §13.8, ADR-0005 §4.5): reference values gain the
-- remaining rating-metadata fields so ratings can label reference concepts
-- distinctly and never mix them silently.
--  * 'referenceType' in ('goal','observed','historical-potential'); absent is allowed and
--    defaults to 'goal' app-side (legacy rows), never guessed otherwise.
--  * 'statistic' in ('median','p80','mean','other'); absent defaults to 'other'.
--  * 'recordedOn' null or a 'YYYY-MM-DD' calendar date.
--  * 'equipmentId' null or a uuid (equipment identity).
-- Only the validator is replaced: save/restore pass the row through it and the
-- jsonb shape is otherwise unchanged, so no data migration is needed and old
-- rows remain valid.
create or replace function private.valid_reference_value(v jsonb) returns boolean language plpgsql immutable set search_path='' as $$ begin
 if not coalesce(jsonb_typeof(v)='object' and jsonb_typeof(v->'id')='string' and lower(v->>'id') ~ '^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$' and jsonb_typeof(v->'club')='string' and length(private.js_trim(v->>'club')) between 1 and 30 and lower(private.js_trim(v->>'club')) not in ('?','unknown','--') and v->>'metric' in ('carry','total') and jsonb_typeof(v->'valueM')='number' and (v->>'valueM') ~ '^[0-9]+(\.[0-9]+)?$' and (v->>'valueM')::numeric>0 and (v->>'valueM')::numeric<=500 and (v->'note'='null'::jsonb or (jsonb_typeof(v->'note')='string' and length(private.js_trim(v->>'note'))<=200)) and (v->'basis' is null or v->>'basis' in ('range','range-flat','premium','premium-flat','unknown')) and (v->'source' is null or v->>'source' in ('manual','fitting','chart','estimated')) and (v->'referenceType' is null or v->>'referenceType' in ('goal','observed','historical-potential')) and (v->'statistic' is null or v->>'statistic' in ('median','p80','mean','other')) and (v->'recordedOn'='null'::jsonb or (jsonb_typeof(v->'recordedOn')='string' and v->>'recordedOn' ~ '^\d{4}-\d{2}-\d{2}$')) and (v->'equipmentId'='null'::jsonb or (jsonb_typeof(v->'equipmentId')='string' and lower(v->>'equipmentId') ~ '^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$')) and jsonb_typeof(v->'revision')='number' and (v->>'revision') ~ '^[0-9]+$' and (v->>'revision')::integer>=0,false) then return false; end if;
 return true; exception when others then return false; end $$;
