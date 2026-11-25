\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(b boolean, msg text) returns void language plpgsql as $$ begin if not coalesce(b,false) then raise exception 'assertion failed: %',msg; end if; end $$;
create function pg_temp.measurements(carry jsonb) returns jsonb language sql as $$ select jsonb_object_agg(k,case when k='carryRange' then carry else 'null'::jsonb end) from unnest(array['carryRange','flatCarryRange','carryPremium','flatCarryPremium','totalRange','flatTotalRange','totalPremium','flatTotalPremium','apexRange','apexPremium','speedRange','speedPremium','launchRange','launchPremium','launchDirection','fromCentre','curve','proximity','target','strokesGained']) k $$;
create function pg_temp.input() returns jsonb language sql as $$ select jsonb_build_object('filename','synthetic.csv','date','2026-11-16','time',null,'venue','','notes','','confirmedFull',true,'allowSameDay',false,'preview',jsonb_build_object('originalBase64',encode(convert_to(E'Shot #,Club,Carry Dist. Range (m)\n1,7i,0\n2,PW,','utf8'),'base64'),'fileHash',encode(extensions.digest(convert_to(E'Shot #,Club,Carry Dist. Range (m)\n1,7i,0\n2,PW,','utf8'),'sha256'),'hex'),'contentHash',encode(extensions.digest(convert_to('[["Carry Dist. Range (m)","Club","Shot #"],[["0","7i","1"],["","PW","2"]]]','utf8'),'sha256'),'hex'),'headers',jsonb_build_array('Shot #','Club','Carry Dist. Range (m)'),'parserVersion','inrange-1','shots',jsonb_build_array(jsonb_build_object('rowIndex',1,'sourceNumber','1','recordedClub','7i','raw',jsonb_build_object('Club','7i','Shot #','1','Carry Dist. Range (m)','0'),'measurements',pg_temp.measurements('0'::jsonb)),jsonb_build_object('rowIndex',2,'sourceNumber','2','recordedClub','PW','raw',jsonb_build_object('Club','PW','Shot #','2','Carry Dist. Range (m)',''),'measurements',pg_temp.measurements('null'::jsonb))))) $$;
select pg_temp.assert_true(private.canonical_hash(jsonb_build_object('headers',jsonb_build_array('Shot #','Club','Carry Dist. Range (m)','é, "q"','😀',''),'shots',jsonb_build_array(jsonb_build_object('raw',jsonb_build_object('Shot #','1','Club','7i','Carry Dist. Range (m)','0','é, "q"',' space, "quote" 😀 ','😀','x','','y')))))='3da08ca998e072b767b78862874591f18d03f73d20ce3b6390d9c8dcfcd83809','JS canonical UTF-16 and escaping');
select pg_temp.assert_true(not private.valid_shot(jsonb_set(pg_temp.input()->'preview'->'shots'->0,'{measurements}',(pg_temp.input()->'preview'->'shots'->0->'measurements')-'curve')),'missing measurement rejected');
select pg_temp.assert_true(not private.valid_shot(jsonb_set(pg_temp.input()->'preview'->'shots'->0,'{measurements,carryRange}','-1')),'negative carry rejected');
select pg_temp.assert_true(not private.valid_shot(jsonb_set(pg_temp.input()->'preview'->'shots'->0,'{sourceNumber}','"different"')),'source number mismatch rejected');
select pg_temp.assert_true(not private.valid_shot(jsonb_set(pg_temp.input()->'preview'->'shots'->0,'{recordedClub}','"other"')),'club mismatch rejected');
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select pg_temp.assert_true(public.dataset_version()=0,'initial version');
do $$ declare bad jsonb:=pg_temp.input(); begin bad:=jsonb_set(bad,'{preview,originalBase64}',to_jsonb(encode(convert_to('synthetic','utf8'),'base64'))); bad:=jsonb_set(bad,'{preview,fileHash}',to_jsonb(encode(extensions.digest(convert_to('synthetic','utf8'),'sha256'),'hex'))); begin perform public.commit_import(bad); raise exception 'non-CSV accepted'; exception when raise_exception then if sqlerrm='non-CSV accepted' then raise; end if; end; end $$;
select public.commit_import(pg_temp.input());
select pg_temp.assert_true(public.dataset_version()=1,'import version');
select pg_temp.assert_true((public.commit_import(pg_temp.input())->>'duplicate')::boolean,'duplicate');
select pg_temp.assert_true(public.dataset_version()=1,'duplicate version');
do $$ declare i jsonb:=pg_temp.input(); begin i:=jsonb_set(i,'{preview,originalBase64}',to_jsonb(encode(convert_to(E'Shot #,Club,Carry Dist. Range (m)\r\n1,7i,0\r\n2,PW,','utf8'),'base64'))); i:=jsonb_set(i,'{preview,fileHash}',to_jsonb(encode(extensions.digest(convert_to(E'Shot #,Club,Carry Dist. Range (m)\r\n1,7i,0\r\n2,PW,','utf8'),'sha256'),'hex'))); if not (public.commit_import(i)->>'duplicate')::boolean then raise exception 'content duplicate missed'; end if; i:=jsonb_set(i,'{preview,contentHash}',to_jsonb(repeat('f',64))); begin perform public.commit_import(i); raise exception 'invalid content accepted'; exception when raise_exception then if sqlerrm='invalid content accepted' then raise; end if; end; end $$;

select pg_temp.assert_true((select count(*)=2 from jsonb_array_elements(public.dataset_page('shots',0,100))) ,'two shots');
select pg_temp.assert_true((select count(*)=1 from jsonb_array_elements(public.dataset_page('shots',0,100)) s where s->'review'->>'intent'='full') ,'wedge intent');
select pg_temp.assert_true((select count(*)=1 from jsonb_array_elements(public.dataset_page('shots',0,100)) s where s->'measurements'->'carryRange'='0'::jsonb) ,'zero retained');
do $$ begin begin insert into public.sessions values(gen_random_uuid(),auth.uid(),'{}'); raise exception 'direct write allowed'; exception when insufficient_privilege then null; end; end $$;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select pg_temp.assert_true(public.dataset_page('shots',0,100)='[]'::jsonb,'other owner isolation');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
create temp table saved as select jsonb_build_object('version',public.dataset_version(),'sessions',public.dataset_page('sessions',0,100),'shots',public.dataset_page('shots',0,100),'imports',public.dataset_page('imports',0,100),'events',public.dataset_page('events',0,100)) as dataset;
do $$ declare s jsonb; r jsonb; id text; begin s:=public.dataset_page('shots',0,100)->0; id:=s->>'id'; r:=jsonb_set(s->'review','{contact}','"typical"'); perform public.apply_reviews(jsonb_build_array(jsonb_build_object('shotId',id,'expectedRevision',0,'review',r))); if (select revision from public.reviews where shot_id=id::uuid)<>1 then raise exception 'revision'; end if; perform public.undo_reviews(jsonb_build_array(jsonb_build_object('shotId',id,'expectedRevision',1))); if (select revision from public.reviews where shot_id=id::uuid)<>2 then raise exception 'undo revision'; end if; begin perform public.apply_reviews(jsonb_build_array(jsonb_build_object('shotId',id,'expectedRevision',0,'review',r))); raise exception 'stale accepted'; exception when raise_exception then if sqlerrm='stale accepted' then raise; end if; end; end $$;
do $$ declare shots jsonb:=public.dataset_page('shots',0,100); first_shot jsonb:=shots->0; second_shot jsonb:=shots->1; r jsonb:=jsonb_set(first_shot->'review','{contact}','"mishit"'); current_rev integer:=(first_shot->>'revision')::integer; begin
 begin perform public.apply_reviews(jsonb_build_array(jsonb_build_object('shotId',first_shot->>'id','expectedRevision',current_rev,'review',r),jsonb_build_object('shotId',second_shot->>'id','expectedRevision',999,'review',r))); raise exception 'batch accepted'; exception when raise_exception then if sqlerrm='batch accepted' then raise; end if; end;
 if (select revision from public.reviews where shot_id=(first_shot->>'id')::uuid)<>current_rev then raise exception 'batch did not roll back'; end if;
 end $$;
do $$ declare sess jsonb:=public.dataset_page('sessions',0,100)->0; begin perform public.update_session(jsonb_set(sess,'{archived}','true')); if not ((public.dataset_page('sessions',0,100)->0->>'archived')::boolean) then raise exception 'archive failed'; end if; begin perform public.update_session(sess); raise exception 'stale session accepted'; exception when raise_exception then if sqlerrm='stale session accepted' then raise; end if; end; end $$;
update saved set dataset=jsonb_build_object('version',public.dataset_version(),'sessions',public.dataset_page('sessions',0,100),'shots',public.dataset_page('shots',0,100),'imports',public.dataset_page('imports',0,100),'events',public.dataset_page('events',0,100));
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select public.restore_backup(dataset) from saved;
select pg_temp.assert_true(jsonb_array_length(public.dataset_page('shots',0,100))=2,'restore same IDs');
select pg_temp.assert_true((select dataset->'events'=public.dataset_page('events',0,100) from saved),'restore undo markers');
do $$ begin begin perform public.restore_backup((select dataset from saved)); raise exception 'nonempty accepted'; exception when raise_exception then if sqlerrm='nonempty accepted' then raise; end if; end; end $$;

-- Roadmap row 3: equipment persistence. Owner A keeps its imported dataset; owner C
-- is a second seeded account; owners D/E/F are empty restore targets. All writes are
-- rolled back with the surrounding transaction.
create function pg_temp.must_fail(p_sql text, expected_message text default null) returns void language plpgsql as $$
begin
 begin execute p_sql;
 exception when others then
  if expected_message is not null and sqlerrm<>expected_message then raise; end if;
  return;
 end;
 raise exception 'expected rejection: %',p_sql;
end $$;
create function pg_temp.shot_at(row_index integer) returns jsonb language sql as $$
 select shot from jsonb_array_elements(public.dataset_page('shots',0,100)) shot
 where (shot->>'rowIndex')::integer = row_index
$$;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
create temp table eq_ctx(owner text primary key, session_id text, shot_1 text, shot_2 text);
insert into eq_ctx select 'A',pg_temp.shot_at(1)->>'sessionId',pg_temp.shot_at(1)->>'id',pg_temp.shot_at(2)->>'id';
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
select pg_temp.assert_true(public.dataset_page('equipment',0,100)='[]'::jsonb,'fresh account has no equipment');
select pg_temp.assert_true(public.dataset_page('equipmentAssignments',0,100)='[]'::jsonb,'fresh account has no assignments');
select public.commit_import(pg_temp.input());
insert into eq_ctx select 'C',pg_temp.shot_at(1)->>'sessionId',pg_temp.shot_at(1)->>'id',pg_temp.shot_at(2)->>'id';

-- Create equipment: nullable optionals, initial revision, same label twice, one bump per write.
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$ declare v0 bigint:=public.dataset_version(); e jsonb; begin
 perform public.save_equipment(jsonb_build_object('id','aaaaaaaa-0000-4000-8000-000000000001','inrangeLabel','7i','name','Lab 7i A','manufacturer',null,'loft',null,'status','in-bag','acquiredOn',null,'retiredOn',null,'revision',null));
 if public.dataset_version()<>v0+1 then raise exception 'equipment create version'; end if;
 perform public.save_equipment(jsonb_build_object('id','aaaaaaaa-0000-4000-8000-000000000002','inrangeLabel','7i','name','Lab 7i B','manufacturer','Mizuno','loft',null,'status','in-bag','acquiredOn','2025-01-01','retiredOn',null,'revision',null));
 if public.dataset_version()<>v0+2 then raise exception 'second equipment create version'; end if;
 select value into e from jsonb_array_elements(public.dataset_page('equipment',0,100)) value where value->>'id'='aaaaaaaa-0000-4000-8000-000000000001';
 if e is null then raise exception 'equipment missing from snapshot'; end if;
 if e->>'inrangeLabel'<>'7i' or e->>'name'<>'Lab 7i A' or e->>'status'<>'in-bag' then raise exception 'equipment snapshot fields'; end if;
 if e->'manufacturer' is distinct from 'null'::jsonb or e->'loft' is distinct from 'null'::jsonb or e->'acquiredOn' is distinct from 'null'::jsonb or e->'retiredOn' is distinct from 'null'::jsonb then raise exception 'nullable optionals'; end if;
 if e->>'revision' !~ '^[0-9]+$' then raise exception 'equipment revision'; end if;
 if (select count(*) from jsonb_array_elements(public.dataset_page('equipment',0,100)) value where value->>'inrangeLabel'='7i')<2 then raise exception 'same label twice rejected'; end if;
 perform pg_temp.must_fail(format('select public.save_equipment(%L::jsonb)',jsonb_set(e,'{revision}','null')), 'Equipment conflict');
 if public.dataset_version()<>v0+2 then raise exception 'rejected duplicate equipment bumped version'; end if;
end $$;

-- Metadata update, retirement, stale-revision rejection without mutation or bump.
do $$ declare e jsonb; u jsonb; rev integer; v0 bigint; begin
 select value into e from jsonb_array_elements(public.dataset_page('equipment',0,100)) value where value->>'id'='aaaaaaaa-0000-4000-8000-000000000001';
 rev:=(e->>'revision')::integer; v0:=public.dataset_version();
 perform public.save_equipment(jsonb_build_object('id',e->>'id','inrangeLabel',e->>'inrangeLabel','name',e->>'name','manufacturer',e->'manufacturer','loft',e->'loft','status','retired','acquiredOn','2025-01-01','retiredOn','2026-02-01','revision',rev));
 if public.dataset_version()<>v0+1 then raise exception 'equipment update version'; end if;
 select value into u from jsonb_array_elements(public.dataset_page('equipment',0,100)) value where value->>'id'=e->>'id';
 if u->>'status'<>'retired' or u->>'retiredOn'<>'2026-02-01' or (u->>'revision')::integer<>rev+1 then raise exception 'equipment update fields'; end if;
 v0:=public.dataset_version();
 perform pg_temp.must_fail(format('select public.save_equipment(%L::jsonb)',jsonb_build_object('id',e->>'id','inrangeLabel',e->>'inrangeLabel','name',e->>'name','manufacturer',e->'manufacturer','loft',e->'loft','status','in-bag','acquiredOn',e->'acquiredOn','retiredOn',e->'retiredOn','revision',rev)));
 if public.dataset_version()<>v0 then raise exception 'stale equipment bumped version'; end if;
 select value into u from jsonb_array_elements(public.dataset_page('equipment',0,100)) value where value->>'id'=e->>'id';
 if u->>'status'<>'retired' then raise exception 'stale equipment mutated state'; end if;
end $$;

-- Assign, verify assignment snapshot, clear with null equipmentId.
do $$ declare v0 bigint; sid text; shot text; eid text; begin
 select session_id,shot_1 into sid,shot from eq_ctx where owner='A';
 select value->>'id' into eid from jsonb_array_elements(public.dataset_page('equipment',0,100)) value where value->>'id'='aaaaaaaa-0000-4000-8000-000000000002';
 v0:=public.dataset_version();
 perform public.assign_equipment(jsonb_build_object('expectedVersion',v0,'sessionId',sid,'clubLabel','7i','equipmentId',eid,'shotIds',jsonb_build_array(shot)));
 if public.dataset_version()<>v0+1 then raise exception 'assignment version'; end if;
 if not exists(select 1 from jsonb_array_elements(public.dataset_page('equipmentAssignments',0,100)) value where value->>'shotId'=shot and value->>'equipmentId'=eid and value->>'clubLabel'='7i') then raise exception 'assignment missing from snapshot'; end if;
 v0:=public.dataset_version();
 perform public.assign_equipment(jsonb_build_object('expectedVersion',v0,'sessionId',sid,'clubLabel','7i','equipmentId',null,'shotIds',jsonb_build_array(shot)));
 if public.dataset_version()<>v0+1 then raise exception 'assignment clear version'; end if;
 if exists(select 1 from jsonb_array_elements(public.dataset_page('equipmentAssignments',0,100)) value where value->>'shotId'=shot) then raise exception 'clear left assignment'; end if;
 v0:=public.dataset_version();
 perform pg_temp.must_fail(format('select public.assign_equipment(%L::jsonb)',jsonb_build_object(
   'expectedVersion',v0,'sessionId',sid,'clubLabel','PW','equipmentId',eid,'shotIds',jsonb_build_array(pg_temp.shot_at(2)->>'id')
 )), 'Equipment label conflict');
 if public.dataset_version()<>v0 then raise exception 'rejected equipment label bumped version'; end if;
end $$;

-- Stale preview rejected; a batch containing a foreign shot fails atomically.
do $$ declare v0 bigint; sid text; s1 text; before_count integer; eid text; begin
 select session_id,shot_1 into sid,s1 from eq_ctx where owner='A';
 select value->>'id' into eid from jsonb_array_elements(public.dataset_page('equipment',0,100)) value where value->>'id'='aaaaaaaa-0000-4000-8000-000000000002';
 v0:=public.dataset_version();
 perform pg_temp.must_fail(format('select public.assign_equipment(%L::jsonb)',jsonb_build_object('expectedVersion',v0-1,'sessionId',sid,'clubLabel','7i','equipmentId',eid,'shotIds',jsonb_build_array(s1))));
 if public.dataset_version()<>v0 then raise exception 'stale assignment bumped version'; end if;
 before_count:=(select count(*) from jsonb_array_elements(public.dataset_page('equipmentAssignments',0,100)) value);
 perform pg_temp.must_fail(format('select public.assign_equipment(%L::jsonb)',jsonb_build_object('expectedVersion',v0,'sessionId',sid,'clubLabel','7i','equipmentId',eid,'shotIds',jsonb_build_array(s1,(select shot_1 from eq_ctx where owner='C')))));
 perform pg_temp.must_fail(format('select public.assign_equipment(%L::jsonb)',jsonb_build_object('expectedVersion',v0,'sessionId',sid,'clubLabel','7i','equipmentId',eid,'shotIds',jsonb_build_array(s1,(select shot_2 from eq_ctx where owner='A')))));
 if public.dataset_version()<>v0 then raise exception 'failed assignment bumped version'; end if;
 if (select count(*) from jsonb_array_elements(public.dataset_page('equipmentAssignments',0,100)) value)<>before_count then raise exception 'assignment did not roll back'; end if;
 if exists(select 1 from jsonb_array_elements(public.dataset_page('equipmentAssignments',0,100)) value where value->>'shotId'=s1) then raise exception 'partial assignment persisted'; end if;
end $$;

-- Deterministic paging of both equipment collections inside the snapshot.
do $$ declare sid text; s1 text; s2 text; eid text; full_eq jsonb; full_as jsonb; second_shot jsonb:=pg_temp.shot_at(2); v0 bigint; begin
 select session_id,shot_1,shot_2 into sid,s1,s2 from eq_ctx where owner='A';
 select value->>'id' into eid from jsonb_array_elements(public.dataset_page('equipment',0,100)) value where value->>'id'='aaaaaaaa-0000-4000-8000-000000000002';
 perform public.save_equipment(jsonb_build_object('id','aaaaaaaa-0000-4000-8000-000000000003','inrangeLabel','PW','name','Lab PW','manufacturer',null,'loft',null,'status','in-bag','acquiredOn',null,'retiredOn',null,'revision',null));
 perform public.apply_reviews(jsonb_build_array(jsonb_build_object(
   'shotId',s2,'expectedRevision',(second_shot->>'revision')::integer,
   'review',jsonb_set(second_shot->'review','{club}',jsonb_build_object('kind','corrected','club','7i'))
 )));
 v0:=public.dataset_version();
 perform public.assign_equipment(jsonb_build_object('expectedVersion',v0,'sessionId',sid,'clubLabel','7i','equipmentId',eid,'shotIds',jsonb_build_array(s1,s2)));
 if public.dataset_version()<>v0+1 then raise exception 'batch assignment version'; end if;
 full_eq:=public.dataset_page('equipment',0,100);
 if jsonb_array_length(full_eq)<>3 then raise exception 'equipment count'; end if;
 if (public.dataset_page('equipment',0,1)||public.dataset_page('equipment',1,1)||public.dataset_page('equipment',2,1)) is distinct from full_eq then raise exception 'equipment paging not deterministic'; end if;
 full_as:=public.dataset_page('equipmentAssignments',0,100);
 if jsonb_array_length(full_as)<>2 then raise exception 'assignment count'; end if;
 if (public.dataset_page('equipmentAssignments',0,1)||public.dataset_page('equipmentAssignments',1,1)) is distinct from full_as then raise exception 'assignment paging not deterministic'; end if;
end $$;

-- Direct writes to the public tables are not granted; RLS keeps readers owner-scoped.
do $$ begin
 begin insert into public.equipment default values; raise exception 'equipment insert allowed'; exception when insufficient_privilege then null; end;
 begin delete from public.equipment; raise exception 'equipment delete allowed'; exception when insufficient_privilege then null; end;
 begin insert into public.equipment_assignments default values; raise exception 'assignment insert allowed'; exception when insufficient_privilege then null; end;
 begin delete from public.equipment_assignments; raise exception 'assignment delete allowed'; exception when insufficient_privilege then null; end;
end $$;

-- Wrong-owner references: equipment, session and shot ids must all belong to the caller.
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
do $$ declare v0 bigint:=public.dataset_version(); sid_c text; shot_c text; sid_a text; shot_a text; eid_c text; eid_a text:='aaaaaaaa-0000-4000-8000-000000000002'; begin
 select session_id,shot_1 into sid_c,shot_c from eq_ctx where owner='C';
 select session_id,shot_1 into sid_a,shot_a from eq_ctx where owner='A';
 perform public.save_equipment(jsonb_build_object('id','cccccccc-0000-4000-8000-000000000001','inrangeLabel','7i','name','Lab 7i C','manufacturer',null,'loft',null,'status','in-bag','acquiredOn',null,'retiredOn',null,'revision',null));
 select value->>'id' into eid_c from jsonb_array_elements(public.dataset_page('equipment',0,100)) value where value->>'id'='cccccccc-0000-4000-8000-000000000001';
 if exists(select 1 from jsonb_array_elements(public.dataset_page('equipment',0,100)) value where value->>'id'=eid_a) then raise exception 'cross-owner equipment visible'; end if;
 perform pg_temp.must_fail(format('select public.assign_equipment(%L::jsonb)',jsonb_build_object('expectedVersion',public.dataset_version(),'sessionId',sid_c,'clubLabel','7i','equipmentId',eid_a,'shotIds',jsonb_build_array(shot_c))));
 perform pg_temp.must_fail(format('select public.assign_equipment(%L::jsonb)',jsonb_build_object('expectedVersion',public.dataset_version(),'sessionId',sid_a,'clubLabel','7i','equipmentId',eid_c,'shotIds',jsonb_build_array(shot_c))));
 perform pg_temp.must_fail(format('select public.assign_equipment(%L::jsonb)',jsonb_build_object('expectedVersion',public.dataset_version(),'sessionId',sid_c,'clubLabel','7i','equipmentId',eid_c,'shotIds',jsonb_build_array(shot_a))));
 perform pg_temp.must_fail(format('select public.save_equipment(%L::jsonb)',jsonb_build_object('id',eid_a,'inrangeLabel','7i','name','hijack','manufacturer',null,'loft',null,'status','in-bag','acquiredOn',null,'retiredOn',null,'revision',0)));
 if public.dataset_version()<>v0+1 then raise exception 'isolation probes mutated version'; end if;
 if exists(select 1 from jsonb_array_elements(public.dataset_page('equipmentAssignments',0,100)) value) then raise exception 'isolation probe created assignment'; end if;
 if (select count(*) from public.equipment)<>1 or exists(select 1 from public.equipment_assignments) then raise exception 'direct select leaked another owner'; end if;
end $$;

-- Check the foreign keys independently of RPC validation and RLS.
reset role;
do $$ declare owner_c uuid:='33333333-3333-4333-8333-333333333333'; begin
 begin
  insert into public.equipment_assignments(shot_id,owner_id,equipment_id,club_label)
  values((select shot_1::uuid from eq_ctx where owner='C'),owner_c,'aaaaaaaa-0000-4000-8000-000000000002','7i');
  raise exception 'cross-owner equipment foreign key accepted';
 exception when foreign_key_violation then null; end;
 begin
  insert into public.equipment_assignments(shot_id,owner_id,equipment_id,club_label)
  values((select shot_1::uuid from eq_ctx where owner='A'),owner_c,'cccccccc-0000-4000-8000-000000000001','7i');
  raise exception 'cross-owner shot foreign key accepted';
 exception when foreign_key_violation then null; end;
end $$;
set local role authenticated;

-- Keep the original assignment after a later club correction creates a mismatch.
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$ declare s jsonb:=pg_temp.shot_at(1); begin
 perform public.apply_reviews(jsonb_build_array(jsonb_build_object(
   'shotId',s->>'id','expectedRevision',(s->>'revision')::integer,
   'review',jsonb_set(s->'review','{club}',jsonb_build_object('kind','corrected','club','PW'))
 )));
 if not exists(select 1 from jsonb_array_elements(public.dataset_page('equipmentAssignments',0,100)) value where value->>'shotId'=s->>'id' and value->>'clubLabel'='7i') then raise exception 'mismatched assignment not retained'; end if;
end $$;

-- Snapshot both backup shapes from owner A: v1 without equipment arrays, v2 with them.
create temp table eq_backup as select
 jsonb_build_object('version',public.dataset_version(),'sessions',public.dataset_page('sessions',0,100),'shots',public.dataset_page('shots',0,100),'imports',public.dataset_page('imports',0,100),'events',public.dataset_page('events',0,100)) as v1,
 jsonb_build_object('version',public.dataset_version(),'sessions',public.dataset_page('sessions',0,100),'shots',public.dataset_page('shots',0,100),'imports',public.dataset_page('imports',0,100),'events',public.dataset_page('events',0,100),'equipment',public.dataset_page('equipment',0,100),'equipmentAssignments',public.dataset_page('equipmentAssignments',0,100)) as v2;

-- v1 restore: empty equipment collections, original IDs and CSV provenance intact.
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
select public.restore_backup(v1) from eq_backup;
do $$ declare b jsonb; begin select v1 into b from eq_backup;
 perform pg_temp.assert_true(public.dataset_page('equipment',0,100)='[]'::jsonb,'v1 restore equipment empty');
 perform pg_temp.assert_true(public.dataset_page('equipmentAssignments',0,100)='[]'::jsonb,'v1 restore assignments empty');
 perform pg_temp.assert_true(b->'sessions'=public.dataset_page('sessions',0,100),'v1 restore sessions');
 perform pg_temp.assert_true(b->'shots'=public.dataset_page('shots',0,100),'v1 restore shot IDs');
 perform pg_temp.assert_true(b->'imports'=public.dataset_page('imports',0,100),'v1 restore CSV provenance');
 perform pg_temp.assert_true(b->'events'=public.dataset_page('events',0,100),'v1 restore events');
end $$;

-- v2 restore: equipment, assignments and the awaiting-review mismatch round-trip.
select set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',true);
select public.restore_backup(v2) from eq_backup;
do $$ declare b jsonb; begin select v2 into b from eq_backup;
 perform pg_temp.assert_true(b->'equipment'=public.dataset_page('equipment',0,100),'v2 restore equipment');
 perform pg_temp.assert_true(b->'equipmentAssignments'=public.dataset_page('equipmentAssignments',0,100),'v2 restore assignments');
 perform pg_temp.assert_true(b->'shots'=public.dataset_page('shots',0,100),'v2 restore shots');
 perform pg_temp.assert_true(b->'imports'=public.dataset_page('imports',0,100),'v2 restore CSV provenance');
 if not exists(select 1 from jsonb_array_elements(public.dataset_page('equipmentAssignments',0,100)) a where a->>'clubLabel'='7i' and a->>'shotId'=pg_temp.shot_at(1)->>'id' and pg_temp.shot_at(1)->'review'->'club'->>'club'='PW') then raise exception 'mismatch awaiting review not preserved'; end if;
end $$;

-- A v2 restore rejects tampered shot provenance and rolls back equipment too.
select set_config('request.jwt.claim.sub','77777777-7777-4777-8777-777777777777',true);
do $$ declare b jsonb; begin
 select jsonb_set(v2,'{shots,0,recordedClub}','"different"') into b from eq_backup;
 perform pg_temp.must_fail(format('select public.restore_backup(%L::jsonb)',b));
 select jsonb_set(v2,'{equipment,0,revision}','"0"') into b from eq_backup;
 perform pg_temp.must_fail(format('select public.restore_backup(%L::jsonb)',b));
 perform pg_temp.must_fail('select public.restore_backup((select v2 - ''equipmentAssignments'' from eq_backup))');
 if public.dataset_version()<>0 or public.dataset_page('equipment',0,100)<>'[]'::jsonb or public.dataset_page('sessions',0,100)<>'[]'::jsonb then raise exception 'invalid v2 restore left partial state'; end if;
end $$;

-- An account holding only equipment is not empty for restore.
select set_config('request.jwt.claim.sub','66666666-6666-4666-8666-666666666666',true);
do $$ declare v0 bigint; begin
 perform public.save_equipment(jsonb_build_object('id','ffffffff-0000-4000-8000-000000000001','inrangeLabel','7i','name','Lab only','manufacturer',null,'loft',null,'status','in-bag','acquiredOn',null,'retiredOn',null,'revision',null));
 v0:=public.dataset_version();
 perform pg_temp.must_fail('select public.restore_backup((select v1 from eq_backup))');
 if public.dataset_version()<>v0 then raise exception 'rejected restore bumped version'; end if;
 perform pg_temp.assert_true(public.dataset_page('equipment',0,100)<>'[]'::jsonb,'equipment-only account lost equipment');
end $$;

-- A restored club at the revision limit reports the limit without writing.
select set_config('request.jwt.claim.sub','77777777-7777-4777-8777-777777777777',true);
do $$ declare club jsonb; v0 bigint; begin
 perform public.restore_backup((select jsonb_set(v2,'{equipment,0,revision}','2147483647') from eq_backup));
 club:=public.dataset_page('equipment',0,1)->0;
 v0:=public.dataset_version();
 begin
  perform public.save_equipment(jsonb_set(club,'{name}','"Revised"'));
  raise exception 'equipment revision limit write accepted';
 exception when raise_exception then
  if sqlerrm<>'Equipment revision limit reached' then raise; end if;
 end;
 if public.dataset_version()<>v0 or public.dataset_page('equipment',0,1)->0 is distinct from club then raise exception 'revision limit write mutated data'; end if;
end $$;

-- User-entered reference values (roadmap §7.5 personal references): owner-scoped,
-- revisioned, one per club+metric (case-insensitive club), separate from shots.
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select pg_temp.assert_true(public.dataset_page('userReferenceValues',0,100)='[]'::jsonb,'fresh account has no reference values');
do $$ declare v0 bigint; r jsonb; rev integer; begin
 v0:=public.dataset_version();
 r:=public.save_reference_value(jsonb_build_object('id','bbbbbbbb-0000-4000-8000-000000000001','club','7i','metric','carry','valueM',142,'note','Fitting session','revision',null));
 if public.dataset_version()<>v0+1 then raise exception 'reference create version'; end if;
 if r->>'revision'<>'0' then raise exception 'reference create revision'; end if;
 perform pg_temp.must_fail(format('select public.save_reference_value(%L::jsonb)',jsonb_build_object('id','bbbbbbbb-0000-4000-8000-000000000002','club','7i','metric','carry','valueM',0,'note',null,'revision',null)),'Invalid reference value');
 perform pg_temp.must_fail(format('select public.save_reference_value(%L::jsonb)',jsonb_build_object('id','bbbbbbbb-0000-4000-8000-000000000002','club','7i','metric','launch','valueM',10,'note',null,'revision',null)),'Invalid reference value');
 perform pg_temp.must_fail(format('select public.save_reference_value(%L::jsonb)',jsonb_build_object('id','bbbbbbbb-0000-4000-8000-000000000002','club','7i','metric','carry','valueM',600,'note',null,'revision',null)),'Invalid reference value');
 perform pg_temp.must_fail(format('select public.save_reference_value(%L::jsonb)',jsonb_build_object('id','not-a-uuid','club','7i','metric','carry','valueM',142,'note',null,'revision',null)),'Invalid reference value');
 if public.dataset_version()<>v0+1 then raise exception 'invalid reference bumped version'; end if;
 perform pg_temp.must_fail(format('select public.save_reference_value(%L::jsonb)',jsonb_build_object('id','bbbbbbbb-0000-4000-8000-000000000002','club','7I','metric','carry','valueM',140,'note',null,'revision',null)),'Reference value conflict');
 perform pg_temp.must_fail(format('select public.save_reference_value(%L::jsonb)',jsonb_set(r,'{revision}','null')),'Reference value conflict');
 perform public.save_reference_value(jsonb_build_object('id','bbbbbbbb-0000-4000-8000-000000000003','club','7i','metric','total','valueM',165,'note',null,'revision',null));
 rev:=(r->>'revision')::integer;
 perform pg_temp.must_fail(format('select public.save_reference_value(%L::jsonb)',jsonb_build_object('id',r->>'id','club','7i','metric','carry','valueM',150,'note',null,'revision',rev+5)),'Reference value conflict');
 v0:=public.dataset_version();
 r:=public.save_reference_value(jsonb_build_object('id',r->>'id','club','7i','metric','carry','valueM',150,'note','Updated','revision',rev));
 if public.dataset_version()<>v0+1 then raise exception 'reference update version'; end if;
 if (r->>'revision')::integer<>rev+1 or r->>'valueM'<>'150' or r->>'note'<>'Updated' then raise exception 'reference update fields'; end if;
 if jsonb_array_length(public.dataset_page('userReferenceValues',0,100))<>2 then raise exception 'reference count'; end if;
 if (public.dataset_page('userReferenceValues',0,1)||public.dataset_page('userReferenceValues',1,1)) is distinct from public.dataset_page('userReferenceValues',0,100) then raise exception 'reference paging not deterministic'; end if;
 v0:=public.dataset_version();
 perform public.delete_reference_value((r->>'id')::uuid);
 if public.dataset_version()<>v0+1 then raise exception 'reference delete version'; end if;
 if jsonb_array_length(public.dataset_page('userReferenceValues',0,100))<>1 then raise exception 'reference delete count'; end if;
 perform pg_temp.must_fail(format('select public.delete_reference_value(%L::uuid)',r->>'id'),'Reference value conflict');
end $$;

-- Owner isolation: another owner sees none of it and cannot write or delete it.
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
select pg_temp.assert_true(public.dataset_page('userReferenceValues',0,100)='[]'::jsonb,'reference owner isolation');
do $$ begin perform pg_temp.must_fail(format('select public.delete_reference_value(%L::uuid)','bbbbbbbb-0000-4000-8000-000000000003'),'Reference value conflict'); end $$;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$ begin begin insert into public.user_reference_values values(gen_random_uuid(),auth.uid(),'{}'); raise exception 'direct reference write allowed'; exception when insufficient_privilege then null; end; end $$;

-- Restore: v2 datasets without the key still restore; a dataset with reference values round-trips.
select set_config('request.jwt.claim.sub','88888888-8888-4888-8888-888888888888',true);
select public.restore_backup(v2) from eq_backup;
select pg_temp.assert_true(public.dataset_page('userReferenceValues',0,100)='[]'::jsonb,'v2 restore reference values empty');
-- Invalid reference payloads are rejected on an empty account before anything is written.
select set_config('request.jwt.claim.sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd',true);
do $$ declare b jsonb; v0 bigint; begin
 select jsonb_build_object('version',0,'sessions',public.dataset_page('sessions',0,100),'shots',public.dataset_page('shots',0,100),'imports',public.dataset_page('imports',0,100),'events',public.dataset_page('events',0,100),'equipment',public.dataset_page('equipment',0,100),'equipmentAssignments',public.dataset_page('equipmentAssignments',0,100),'userReferenceValues',jsonb_build_array(jsonb_build_object('id','cccccccc-0000-4000-8000-000000000001','club','7i','metric','carry','valueM',142,'note',null,'revision',0))) into b from eq_backup limit 1;
 v0:=public.dataset_version();
 perform pg_temp.must_fail(format('select public.restore_backup(%L::jsonb)',jsonb_set(b,'{userReferenceValues,0,valueM}','600')),'Invalid backup reference value');
 perform pg_temp.must_fail(format('select public.restore_backup(%L::jsonb)',jsonb_set(b,'{userReferenceValues}',jsonb_build_array(jsonb_build_object('id','cccccccc-0000-4000-8000-000000000002','club','7I','metric','carry','valueM',140,'note',null,'revision',0),jsonb_build_object('id','cccccccc-0000-4000-8000-000000000001','club','7i','metric','carry','valueM',142,'note',null,'revision',0)))),'Invalid backup reference value');
 perform pg_temp.must_fail(format('select public.restore_backup(%L::jsonb)',jsonb_set(b,'{userReferenceValues}',jsonb_build_array(jsonb_build_object('id','cccccccc-0000-4000-8000-000000000002','club','7i','metric','carry','valueM',142,'note',null,'revision',0),jsonb_build_object('id','cccccccc-0000-4000-8000-000000000001','club','7i','metric','carry','valueM',142,'note',null,'revision',0)))),'Invalid backup reference value');
 if public.dataset_version()<>v0 then raise exception 'rejected restore bumped version'; end if;
 perform public.restore_backup(b);
 perform pg_temp.assert_true(jsonb_array_length(public.dataset_page('userReferenceValues',0,100))=1,'restore reference values count');
 perform pg_temp.assert_true((public.dataset_page('userReferenceValues',0,100)->0->>'valueM')='142','restore reference value fields');
 perform pg_temp.must_fail(format('select public.restore_backup(%L::jsonb)',b),'Restore requires empty dataset');
end $$;

set local role authenticated;
set local role anon;
do $$ begin begin perform public.dataset_version(); raise exception 'anon allowed'; exception when insufficient_privilege then null; end; end $$;
do $$ begin
 begin perform public.save_equipment('{}'::jsonb); raise exception 'anon equipment write allowed'; exception when insufficient_privilege then null; end;
 begin perform public.assign_equipment('{}'::jsonb); raise exception 'anon assignment write allowed'; exception when insufficient_privilege then null; end;
 begin perform public.save_reference_value('{}'::jsonb); raise exception 'anon reference write allowed'; exception when insufficient_privilege then null; end;
 begin perform public.delete_reference_value(gen_random_uuid()); raise exception 'anon reference delete allowed'; exception when insufficient_privilege then null; end;
end $$;
rollback;
