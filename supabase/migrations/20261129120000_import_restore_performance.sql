-- A1 (release readiness): authenticated commit_import / restore_backup of
-- realistic large histories exceeded the authenticated role's 8 s statement
-- timeout (SQLSTATE 57014). Measured on the local stack with a 3,000-shot /
-- 218,304-byte import and a 105-visit / 12,600-shot / 26 MB restore:
--   * private.validate_source parsed the CSV character by character in a
--     PL/pgSQL loop (~64 us/char): 14.1 s of the 14.7 s import and 5.1 s of the
--     8.4 s restore.
--   * private.canonical_hash re-computed header sort keys per shot and grew the
--     row text with one concatenation per row (O(n^2)): 0.49 s import, 1.6 s restore.
--   * private.commit_import / private.restore_backup inserted sessions, imports,
--     shots, reviews, equipment, assignments, reference values and events row by
--     row in PL/pgSQL loops: 0.1 s import, 1.5 s restore.
-- This migration rewrites those stages set-based: the CSV is tokenised by
-- C-level string splitting after masking quoted spans, the canonical hash is
-- built in one pass with precomputed header sort keys, and all inserts are bulk
-- statements. Accept/reject behaviour, error messages, original-byte and raw
-- cell validation, owner scoping, revision checks, import idempotency,
-- atomicity and the empty-account restore safeguard are unchanged; the public
-- RPC signatures and grants are untouched. Regressions: the A1 section of
-- app/tests/db.sql (large import + restore under the default 8 s statement
-- timeout), the forced-timeout atomicity checks in app/scripts/test-db.mjs,
-- and the real-API verification app/scripts/verify-import-restore.ts.

-- One-pass canonical hash: header sort keys are computed once and every shot's
-- cell text is aggregated in a single grouped query instead of per-row loops.
create or replace function private.canonical_hash(p jsonb) returns text language plpgsql stable set search_path='' as $$ declare
 headers text[]; headtext text; rows text; bad boolean;
begin
 if jsonb_typeof(p->'headers') is distinct from 'array' then raise exception 'Invalid headers'; end if;
 if exists(select 1 from jsonb_array_elements(p->'headers') h where jsonb_typeof(h)<>'string' or private.js_trim(h#>>'{}')<>h#>>'{}' or h#>>'{}'='') then raise exception 'Invalid headers'; end if;
 select array_agg(h order by sk collate "C"), string_agg(to_json(h)::text,',' order by sk collate "C") into headers, headtext from (select h, private.js_sort_key(h) as sk from jsonb_array_elements_text(p->'headers') h) t;
 if headers is null or cardinality(headers)<>(select count(distinct h) from unnest(headers) h) or not headers @> array['Shot #','Club','Carry Dist. Range (m)'] then raise exception 'Invalid headers'; end if;
 select coalesce(bool_and(
   jsonb_typeof(s.raw)='object'
   and (select count(*) from jsonb_object_keys(case when jsonb_typeof(s.raw)='object' then s.raw else '{}'::jsonb end))=cardinality(headers)
   and not exists(select 1 from unnest(headers) h where jsonb_typeof(s.raw->h) is distinct from 'string')
 ),true) into bad from (select value->'raw' as raw from jsonb_array_elements(p->'shots') value) s;
 if not bad then raise exception 'Invalid raw cells'; end if;
 with s as (select row_number() over () as rn, value->'raw' as raw from jsonb_array_elements(p->'shots') value),
      h as (select h, private.js_sort_key(h) as sk from unnest(headers) h)
 select coalesce(string_agg('['||cells||']',',' order by rn),'') into rows from (
   select s.rn, string_agg(to_json(s.raw->>h.h)::text,',' order by h.sk) as cells
   from s cross join h group by s.rn
 ) x;
 return encode(extensions.digest(convert_to('[['||headtext||'],['||rows||']]','UTF8'),'sha256'),'hex'); end $$;

-- Set-based CSV validation with identical accept/reject behaviour and error
-- messages. The detected row newline is first replaced by a marker control
-- character that cannot occur in the data (a raw newline in a regex pattern
-- would switch PostgreSQL into newline-sensitive matching), then quoted spans
-- that begin at a field boundary (start of file, after a comma, or after the
-- marker) are masked with a placeholder run that also cannot occur in the
-- data. The remaining text is split on the marker and on commas with C-level
-- string_to_array instead of a per-character loop. A quote left at a field
-- start is an unclosed quote; a placeholder followed by non-whitespace is
-- text after a closing quote; quotes anywhere else remain data characters,
-- exactly like the character-level parser.
create or replace function private.validate_source(original bytea, preview jsonb, parser_version text) returns void language plpgsql stable set search_path='' as $$
declare
 source text; sample text; cr_parts text[]; newline text; n_first integer; cr_first integer; crlf_count integer;
 normalized text; mark text; mark_len integer; pattern text; skeleton text; spans text[]; ph text; ph_len integer;
 lines text[]; line text; raw_fields text[]; fields text[]; f text; rest text; span text;
 span_idx integer:=0; li integer; fi integer; row_no integer:=0; headers text[]; actual jsonb; shot jsonb;
 k text; h text; expected double precision; got double precision; value jsonb; nonempty text;
 mapping jsonb := '{"carryRange":"Carry Dist. Range (m)","flatCarryRange":"Flat Carry Dist. Range (m)","carryPremium":"Carry Dist. Premium (m)","flatCarryPremium":"Flat Carry Dist. Premium (m)","totalRange":"Total Dist. Range (m)","flatTotalRange":"Flat Total Dist. Range (m)","totalPremium":"Total Dist. Premium (m)","flatTotalPremium":"Flat Total Dist. Premium (m)","apexRange":"Apex (m)","apexPremium":"Apex (m) Premium","speedRange":"Ball Speed (kph)","speedPremium":"Ball Speed (kph) Premium","launchRange":"Launch Angle (deg)","launchPremium":"Launch Angle (deg) Premium","launchDirection":"Launch Direction","fromCentre":"From Centre (m)","curve":"Curve","proximity":"Prox to Hole (m)","target":"Target (m)","strokesGained":"Strokes Gained"}'::jsonb;
begin
 if parser_version is distinct from 'inrange-1' then raise exception 'Unsupported parser version'; end if;
 source:=convert_from(original,'UTF8'); if left(source,1)=chr(65279) then source:=substr(source,2); end if;
 sample:=regexp_replace(left(source,1048576),'"[^"]*"','','g'); cr_parts:=string_to_array(sample,E'\r'); n_first:=strpos(sample,E'\n'); cr_first:=strpos(sample,E'\r');
 if cr_first=0 or (n_first>0 and n_first<cr_first) then newline:=E'\n'; else
  select count(*) into crlf_count from unnest(cr_parts) x where left(x,1)=E'\n';
  if crlf_count>=cardinality(cr_parts)/2.0 then newline:=E'\r\n'; else newline:=E'\r'; end if;
 end if;
 ph_len:=1; while strpos(source,repeat(chr(1),ph_len))>0 loop ph_len:=ph_len+1; end loop; ph:=repeat(chr(1),ph_len);
 mark_len:=1; while strpos(source,repeat(chr(2),mark_len))>0 loop mark_len:=mark_len+1; end loop; mark:=repeat(chr(2),mark_len);
 normalized:=replace(source,newline,mark);
 pattern:='(^|,|'||mark||')("(?:[^"]|"")*")';
 select coalesce(array_agg(m[2] order by ord),array[]::text[]) into spans from regexp_matches(normalized,pattern,'g') with ordinality as t(m,ord);
 skeleton:=regexp_replace(normalized,pattern,'\1'||ph,'g');
 lines:=string_to_array(skeleton,mark);
 for li in 1..coalesce(cardinality(lines),0) loop
  line:=lines[li];
  raw_fields:=string_to_array(line,',');
  fields:=array[]::text[];
  for fi in 1..coalesce(cardinality(raw_fields),0) loop
   f:=raw_fields[fi];
   if left(f,ph_len)=ph then
    rest:=substr(f,ph_len+1);
    if private.js_trim(rest)<>'' then raise exception 'Invalid text after CSV quote'; end if;
    span_idx:=span_idx+1; span:=spans[span_idx];
    fields:=array_append(fields,replace(replace(substr(span,2,length(span)-2),'""','"'),mark,newline));
   elsif strpos(f,ph)>0 then
    raise exception 'Invalid text after CSV quote';
   elsif left(f,1)='"' then
    raise exception 'Unclosed CSV quote';
   else
    fields:=array_append(fields,f);
   end if;
  end loop;
  nonempty:=private.js_trim(array_to_string(fields,''));
  if nonempty<>'' then
   if headers is null then
    select array_agg(private.js_trim(x) order by ord) into headers from unnest(fields) with ordinality as t(x,ord);
    if cardinality(headers)<>jsonb_array_length(preview->'headers') or exists(select 1 from unnest(headers) hdr where not (preview->'headers' ? hdr)) then raise exception 'CSV headers do not match'; end if;
   else
    row_no:=row_no+1; if row_no>jsonb_array_length(preview->'shots') or cardinality(fields)<>cardinality(headers) then raise exception 'CSV rows do not match'; end if;
    select jsonb_object_agg(headers[n],fields[n]) into actual from generate_subscripts(headers,1) n;
    shot:=preview->'shots'->(row_no-1);
    if not private.valid_shot(shot) or (shot->>'rowIndex')::integer<>row_no or shot->'raw' is distinct from actual then raise exception 'CSV cells do not match'; end if;
    for k,h in select e.key,e.value from jsonb_each_text(mapping) e loop
     expected:=private.measurement(coalesce(actual->>h,''),k); value:=shot->'measurements'->k;
     if value='null'::jsonb then got:=null; else got:=(value#>>'{}')::double precision; end if;
     if got is distinct from expected then raise exception 'CSV measurement does not match'; end if;
    end loop;
   end if;
  end if;
 end loop;
 if headers is null or row_no=0 or row_no<>jsonb_array_length(preview->'shots') then raise exception 'CSV row count does not match'; end if;
end $$;

-- Bulk shot/review insert. Validation order matches the previous per-row loop:
-- shape first, then valid_shot for every row, then the rowIndex position check
-- (whose ::integer cast can still raise 22003 for out-of-range row numbers,
-- exactly as before). The per-shot review is built in SQL from recordedClub.
create or replace function private.commit_import(p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ declare u uuid:=private.lock_owner(); p jsonb:=p_input->'preview'; raw_bytes bytea; existing uuid; sid uuid:=extensions.gen_random_uuid(); iid uuid:=extensions.gen_random_uuid(); session_data jsonb; bad integer; begin
 if not coalesce(jsonb_typeof(p_input->'confirmedFull')='boolean' and jsonb_typeof(p_input->'allowSameDay')='boolean' and jsonb_typeof(p->'shots')='array' and jsonb_array_length(p->'shots') between 1 and 20000 and jsonb_typeof(p->'originalBase64')='string' and (p->>'fileHash') ~ '^[0-9a-f]{64}$' and (p->>'contentHash') ~ '^[0-9a-f]{64}$' and jsonb_typeof(p->'parserVersion')='string',false) then raise exception 'Invalid import'; end if;
 if private.canonical_hash(p)<>p->>'contentHash' then raise exception 'Invalid content hash'; end if; raw_bytes:=decode(p->>'originalBase64','base64'); if octet_length(raw_bytes)>5242880 or encode(extensions.digest(raw_bytes,'sha256'),'hex')<>p->>'fileHash' then raise exception 'Invalid file hash or size'; end if; perform private.validate_source(raw_bytes,p,p->>'parserVersion');
 select session_id into existing from public.imports where owner_id=u and (file_hash=p->>'fileHash' or content_hash=p->>'contentHash') limit 1; if existing is not null then return jsonb_build_object('sessionId',existing,'duplicate',true); end if;
 session_data:=jsonb_build_object('id',sid,'date',p_input->'date','time',p_input->'time','venue',p_input->'venue','notes',p_input->'notes','archived',false,'filename',p_input->'filename','revision',0); if not private.valid_session(session_data) then raise exception 'Invalid session'; end if;
 if not (p_input->>'allowSameDay')::boolean and exists(select 1 from public.sessions where owner_id=u and data->>'date'=p_input->>'date') then raise exception 'Same-day import requires acknowledgement'; end if;
 insert into public.sessions values(sid,u,session_data); insert into public.imports values(iid,u,sid,raw_bytes,p->>'fileHash',p->>'contentHash',p->>'parserVersion');
 select min(t.n) into bad from (select row_number() over () as n, value as v from jsonb_array_elements(p->'shots')) t where not private.valid_shot(t.v);
 if bad is not null then raise exception 'Invalid shot row'; end if;
 select min(t.n) into bad from (select row_number() over () as n, value as v from jsonb_array_elements(p->'shots')) t where (t.v->>'rowIndex')::integer<>t.n;
 if bad is not null then raise exception 'Invalid shot row'; end if;
 insert into public.shots select extensions.gen_random_uuid(),u,sid,t.v from (select value as v from jsonb_array_elements(p->'shots')) t;
 insert into public.reviews select s.id,u,jsonb_build_object('intent',case when (p_input->>'confirmedFull')::boolean and trim(s.payload->>'recordedClub') !~* '^(PW|SW|GW|LW|AW|UW|W|[0-9]{2}°?)$' and lower(trim(s.payload->>'recordedClub')) not in ('','?','unknown','--') then 'full' else 'unknown' end,'contact','uncertain','club',jsonb_build_object('kind','unreviewed'),'exclusion',jsonb_build_object('kind','included')),0 from public.shots s where s.owner_id=u and s.session_id=sid;
 perform private.bump(u); return jsonb_build_object('sessionId',sid,'duplicate',false); end $$;

-- Bulk inserts for every restored collection; per-row validation, error
-- messages and stage order are unchanged (first failing array position wins,
-- so single-defect payloads report exactly what they reported before).
create or replace function private.restore_backup(p_dataset jsonb) returns void language plpgsql security definer set search_path='' as $$ declare u uuid:=private.lock_owner(); imp public.imports%rowtype; canonical jsonb; shot_count integer; bad integer; begin
 if exists(select 1 from public.sessions where owner_id=u) or exists(select 1 from public.shots where owner_id=u) or exists(select 1 from public.equipment where owner_id=u) or exists(select 1 from public.equipment_assignments where owner_id=u) or exists(select 1 from public.user_reference_values where owner_id=u) then raise exception 'Restore requires empty dataset'; end if;
 if not coalesce(jsonb_typeof(p_dataset)='object' and (p_dataset->>'version') ~ '^[0-9]+$' and jsonb_typeof(p_dataset->'sessions')='array' and jsonb_typeof(p_dataset->'shots')='array' and jsonb_typeof(p_dataset->'imports')='array' and jsonb_typeof(p_dataset->'events')='array' and jsonb_array_length(p_dataset->'sessions')<=20000 and jsonb_array_length(p_dataset->'shots')<=100000 and jsonb_array_length(p_dataset->'imports')<=20000 and jsonb_array_length(p_dataset->'events')<=200000 and (p_dataset ? 'equipment') = (p_dataset ? 'equipmentAssignments') and (not (p_dataset ? 'equipment') or (jsonb_typeof(p_dataset->'equipment')='array' and jsonb_array_length(p_dataset->'equipment')<=10000)) and (not (p_dataset ? 'equipmentAssignments') or (jsonb_typeof(p_dataset->'equipmentAssignments')='array' and jsonb_array_length(p_dataset->'equipmentAssignments')<=200000)) and (not (p_dataset ? 'userReferenceValues') or (jsonb_typeof(p_dataset->'userReferenceValues')='array' and jsonb_array_length(p_dataset->'userReferenceValues')<=1000)),false) then raise exception 'Invalid backup'; end if;
 select min(t.ord) into bad from (select row_number() over () as ord, value as x from jsonb_array_elements(p_dataset->'sessions')) t where not private.valid_session(t.x);
 if bad is not null then raise exception 'Invalid backup session'; end if;
 insert into public.sessions select (t.x->>'id')::uuid,u,t.x from (select value as x from jsonb_array_elements(p_dataset->'sessions')) t;
 select min(t.ord) into bad from (select row_number() over () as ord, value as x from jsonb_array_elements(p_dataset->'imports')) t where not exists(select 1 from public.sessions s where s.id=(t.x->>'sessionId')::uuid and s.owner_id=u) or not coalesce(jsonb_typeof(t.x->'originalBase64')='string' and jsonb_typeof(t.x->'fileHash')='string' and (t.x->>'fileHash') ~ '^[0-9a-f]{64}$' and jsonb_typeof(t.x->'contentHash')='string' and (t.x->>'contentHash') ~ '^[0-9a-f]{64}$' and jsonb_typeof(t.x->'parserVersion')='string',false);
 if bad is not null then raise exception 'Invalid backup import'; end if;
 select min(t.ord) into bad from (select row_number() over () as ord, value as x from jsonb_array_elements(p_dataset->'imports')) t where octet_length(decode(t.x->>'originalBase64','base64'))>5242880 or encode(extensions.digest(decode(t.x->>'originalBase64','base64'),'sha256'),'hex')<>t.x->>'fileHash';
 if bad is not null then raise exception 'Invalid backup bytes'; end if;
 insert into public.imports select (t.x->>'id')::uuid,u,(t.x->>'sessionId')::uuid,decode(t.x->>'originalBase64','base64'),t.x->>'fileHash',t.x->>'contentHash',t.x->>'parserVersion' from (select value as x from jsonb_array_elements(p_dataset->'imports')) t;
 select min(t.ord) into bad from (select row_number() over () as ord, value as x from jsonb_array_elements(p_dataset->'shots')) t where not exists(select 1 from public.sessions s where s.id=(t.x->>'sessionId')::uuid and s.owner_id=u) or not private.valid_shot(t.x) or not private.valid_review(t.x->'review') or (t.x->>'revision') !~ '^[0-9]+$';
 if bad is not null then raise exception 'Invalid backup shot'; end if;
 insert into public.shots select (t.x->>'id')::uuid,u,(t.x->>'sessionId')::uuid,t.x-'id'-'sessionId'-'review'-'revision' from (select value as x from jsonb_array_elements(p_dataset->'shots')) t;
 insert into public.reviews select (t.x->>'id')::uuid,u,t.x->'review',(t.x->>'revision')::integer from (select value as x from jsonb_array_elements(p_dataset->'shots')) t;
 if p_dataset ? 'equipment' then
  if (select count(*) from jsonb_array_elements(p_dataset->'equipment'))<>(select count(distinct value->>'id') from jsonb_array_elements(p_dataset->'equipment')) then raise exception 'Invalid backup equipment'; end if;
  select min(t.ord) into bad from (select row_number() over () as ord, value as x from jsonb_array_elements(p_dataset->'equipment')) t where not private.valid_equipment(t.x);
  if bad is not null then raise exception 'Invalid backup equipment'; end if;
  insert into public.equipment select (t.x->>'id')::uuid,u,jsonb_set(t.x,'{id}',to_jsonb((t.x->>'id')::uuid)) from (select value as x from jsonb_array_elements(p_dataset->'equipment')) t;
 end if;
 if p_dataset ? 'equipmentAssignments' then
  if (select count(*) from jsonb_array_elements(p_dataset->'equipmentAssignments'))<>(select count(distinct value->>'shotId') from jsonb_array_elements(p_dataset->'equipmentAssignments')) then raise exception 'Invalid backup assignment'; end if;
  select min(t.ord) into bad from (select row_number() over () as ord, value as x from jsonb_array_elements(p_dataset->'equipmentAssignments')) t where
   not coalesce(jsonb_typeof(t.x)='object' and jsonb_typeof(t.x->'shotId')='string' and (t.x->>'shotId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' and jsonb_typeof(t.x->'equipmentId')='string' and (t.x->>'equipmentId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' and jsonb_typeof(t.x->'clubLabel')='string' and length(private.js_trim(t.x->>'clubLabel')) between 1 and 30,false)
   or not exists(select 1 from public.shots s where s.owner_id=u and s.id=(t.x->>'shotId')::uuid)
   or not exists(select 1 from public.equipment e where e.owner_id=u and e.id=(t.x->>'equipmentId')::uuid);
  if bad is not null then raise exception 'Invalid backup assignment'; end if;
  insert into public.equipment_assignments select (t.x->>'shotId')::uuid,u,(t.x->>'equipmentId')::uuid,t.x->>'clubLabel' from (select value as x from jsonb_array_elements(p_dataset->'equipmentAssignments')) t;
 end if;
 if p_dataset ? 'userReferenceValues' then
  if (select count(*) from jsonb_array_elements(p_dataset->'userReferenceValues'))<>(select count(distinct value->>'id') from jsonb_array_elements(p_dataset->'userReferenceValues')) then raise exception 'Invalid backup reference value'; end if;
  if (select count(*) from jsonb_array_elements(p_dataset->'userReferenceValues'))<>(select count(distinct (lower(private.js_trim(value->>'club')),value->>'metric')) from jsonb_array_elements(p_dataset->'userReferenceValues')) then raise exception 'Invalid backup reference value'; end if;
  select min(t.ord) into bad from (select row_number() over () as ord, value as x from jsonb_array_elements(p_dataset->'userReferenceValues')) t where not private.valid_reference_value(t.x);
  if bad is not null then raise exception 'Invalid backup reference value'; end if;
  insert into public.user_reference_values select (t.x->>'id')::uuid,u,jsonb_set(jsonb_set(t.x,'{id}',to_jsonb((t.x->>'id')::uuid)),'{club}',to_jsonb(private.js_trim(t.x->>'club'))) from (select value as x from jsonb_array_elements(p_dataset->'userReferenceValues')) t;
 end if;
 for imp in select * from public.imports where owner_id=u loop
 select count(*),jsonb_build_object('headers',(select jsonb_agg(k) from jsonb_object_keys((select payload->'raw' from public.shots where owner_id=u and session_id=imp.session_id order by (payload->>'rowIndex')::integer limit 1)) k),'shots',jsonb_agg(payload order by (payload->>'rowIndex')::integer)) into shot_count,canonical from public.shots where owner_id=u and session_id=imp.session_id;
 if shot_count=0 or shot_count>20000 or exists(select 1 from (select (payload->>'rowIndex')::integer as n,row_number() over(order by (payload->>'rowIndex')::integer) as expected from public.shots where owner_id=u and session_id=imp.session_id) rows where n<>expected) or private.canonical_hash(canonical)<>imp.content_hash then raise exception 'Invalid backup content'; end if; perform private.validate_source(imp.original,canonical,imp.parser_version);
 end loop;
 select min(t.ord) into bad from (select row_number() over () as ord, value as x from jsonb_array_elements(p_dataset->'events')) t where not exists(select 1 from public.shots s where s.id=(t.x->>'shotId')::uuid and s.owner_id=u) or not private.valid_review(t.x->'before') or not private.valid_review(t.x->'after');
 if bad is not null then raise exception 'Invalid backup event'; end if;
 insert into public.review_events(id,owner_id,shot_id,before_state,after_state,created_at,undone) select (t.x->>'id')::uuid,u,(t.x->>'shotId')::uuid,t.x->'before',t.x->'after',(t.x->>'createdAt')::timestamptz,coalesce((t.x->>'undone')::boolean,false) from (select value as x from jsonb_array_elements(p_dataset->'events')) t;
 if exists(select 1 from public.sessions s where owner_id=u and not exists(select 1 from public.imports i where i.session_id=s.id and i.owner_id=u)) then raise exception 'Session missing import'; end if; perform private.bump(u); end $$;
