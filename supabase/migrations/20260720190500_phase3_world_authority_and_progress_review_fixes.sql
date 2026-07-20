-- Independent-review corrections for the developer-MVP World pass.
-- Bind provenance only after a preparation row identifies its exact spend intent;
-- never infer authority from a broadly matching active intent.

drop trigger if exists bind_world_micro_authorization_aal
  on private.micro_authorizations;
drop function if exists private.bind_world_micro_authorization_aal();

create or replace function private.bind_world_preparation_authorization_aal()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  update private.micro_authorizations authz
  set aal=intent.aal
  from private.world_build_spend_intents intent
  where authz.id=new.micro_authorization_id
    and intent.id=new.spend_intent_id
    and authz.workspace_id=new.workspace_id
    and authz.configuration_candidate_id=intent.configuration_candidate_id
    and authz.script_revision_id=intent.script_revision_id
    and authz.authorized_by=intent.authorized_by
    and authz.actor_authority_epoch=intent.actor_authority_epoch;
  if not found then
    raise exception 'world authorization intent binding is invalid' using errcode='40001';
  end if;
  return new;
end;
$$;

drop trigger if exists bind_world_preparation_authorization_aal
  on private.world_anchor_preparations;
create trigger bind_world_preparation_authorization_aal
after insert on private.world_anchor_preparations
for each row execute function private.bind_world_preparation_authorization_aal();

create or replace function private.bind_narration_preparation_authorization_aal()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  update private.micro_authorizations authz
  set aal=intent.aal
  from private.micro_quote_lines line
  join private.micro_quotes quote on quote.id=line.micro_quote_id
  join private.world_build_spend_intents intent on intent.id=new.spend_intent_id
  where line.id=new.micro_quote_line_id
    and authz.micro_quote_id=quote.id
    and authz.workspace_id=new.workspace_id
    and authz.configuration_candidate_id=intent.configuration_candidate_id
    and authz.script_revision_id=intent.script_revision_id
    and authz.authorized_by=intent.authorized_by
    and authz.actor_authority_epoch=intent.actor_authority_epoch;
  if not found then
    raise exception 'narration authorization intent binding is invalid' using errcode='40001';
  end if;
  return new;
end;
$$;

drop trigger if exists bind_narration_preparation_authorization_aal
  on private.narration_generation_jobs;
create trigger bind_narration_preparation_authorization_aal
after insert on private.narration_generation_jobs
for each row execute function private.bind_narration_preparation_authorization_aal();

update private.micro_authorizations authz
set aal=intent.aal
from private.world_anchor_preparations preparation
join private.world_build_spend_intents intent on intent.id=preparation.spend_intent_id
where authz.id=preparation.micro_authorization_id
  and authz.workspace_id=preparation.workspace_id
  and authz.configuration_candidate_id=intent.configuration_candidate_id
  and authz.script_revision_id=intent.script_revision_id
  and authz.authorized_by=intent.authorized_by
  and authz.actor_authority_epoch=intent.actor_authority_epoch;

update private.micro_authorizations authz
set aal=intent.aal
from private.narration_generation_jobs job
join private.micro_quote_lines line on line.id=job.micro_quote_line_id
join private.micro_quotes quote on quote.id=line.micro_quote_id
join private.world_build_spend_intents intent on intent.id=job.spend_intent_id
where authz.micro_quote_id=quote.id
  and authz.workspace_id=job.workspace_id
  and authz.configuration_candidate_id=intent.configuration_candidate_id
  and authz.script_revision_id=intent.script_revision_id
  and authz.authorized_by=intent.authorized_by
  and authz.actor_authority_epoch=intent.actor_authority_epoch;
