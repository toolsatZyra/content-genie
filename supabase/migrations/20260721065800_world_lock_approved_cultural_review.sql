-- A qualified cultural finding is resolved by the selected qualified review
-- decision. World Lock must pin that approved decision rather than reject the
-- immutable historical finding that prompted it.

do $migration$
declare
  definition text;
  old_guard text := $guard$
    or not exists(select 1 from public.source_review_statuses status
      where status.source_review_packet_id=source_packet.id and status.status='approved')
    or exists(select 1 from public.cultural_readiness_findings finding
      where finding.source_review_packet_id=source_packet.id and finding.verdict in (
        'repair_required','qualified_review_required','production_blocked','release_blocked'))
$guard$;
  new_guard text := $guard$
    or not exists(select 1
      from public.source_review_statuses status
      join public.source_review_decisions decision
        on decision.id=status.selected_decision_id
       and decision.workspace_id=status.workspace_id
      where status.source_review_packet_id=source_packet.id
        and status.workspace_id=p_workspace_id
        and status.status='approved'
        and decision.source_review_packet_id=source_packet.id
        and decision.policy_version_id=source_packet.policy_version_id
        and decision.decision='approve'
        and decision.subject_hash=source_packet.subject_hash
        and decision.source_set_hash=source_packet.source_set_hash
        and decision.evidence_set_hash=source_packet.evidence_set_hash)
$guard$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.command_lock_first_episode_world(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint,text,uuid,text,text,uuid)'::regprocedure
  ) into definition;

  if pg_catalog.strpos(definition, old_guard) = 0 then
    raise exception 'World Lock cultural review guard did not match expected definition';
  end if;

  definition := pg_catalog.replace(definition, old_guard, new_guard);
  execute definition;
end;
$migration$;

revoke all on function public.command_lock_first_episode_world(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint,
  text,uuid,text,text,uuid
) from public,anon,authenticated;
grant execute on function public.command_lock_first_episode_world(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint,
  text,uuid,text,text,uuid
) to authenticated;
