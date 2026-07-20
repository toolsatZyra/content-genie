-- Recover a completed FAL result through the provider's authenticated queue API
-- when a signed webhook could not be accepted. The result still enters the same
-- quarantine, remote-fetch and secure-ingest pipeline; no remote URL is promoted.
alter table private.provider_inbox_messages
  drop constraint provider_inbox_messages_verification_class_check;

alter table private.provider_inbox_messages
  add constraint provider_inbox_messages_verification_class_check
  check (verification_class in (
    'signed','authenticated_poll','poll_signal_only','rejected'
  ));

do $$
declare
  function_signature constant regprocedure:=
    'public.command_record_fal_signed_webhook(uuid,text,text,text,text,text,text,jsonb,jsonb)'::regprocedure;
  definition text:=pg_get_functiondef(function_signature);
  signed_insert constant text:='p_raw_body_sha256, true, ''signed'', statement_timestamp(),';
  classified_insert constant text:=$replacement$p_raw_body_sha256, true,
      case when p_safe_summary ->> 'verificationClass' = 'authenticated_poll'
        then 'authenticated_poll' else 'signed' end, statement_timestamp(),$replacement$;
  summary_limit constant text:='or pg_column_size(p_safe_summary) > 16384';
begin
  if position(signed_insert in definition)=0
    or position(summary_limit in definition)=0
  then
    raise exception 'FAL completion recorder contract changed unexpectedly';
  end if;
  definition:=replace(definition,signed_insert,classified_insert);
  definition:=replace(
    definition,
    summary_limit,
    summary_limit||E'\n    or coalesce(p_safe_summary ->> ''verificationClass'',''signed'') not in (''signed'',''authenticated_poll'')'
  );
  execute definition;
end;
$$;

comment on function public.command_record_fal_signed_webhook(
  uuid,text,text,text,text,text,text,jsonb,jsonb
) is
  'Records an Ed25519-signed FAL webhook or a service-only FAL API-key authenticated recovery result before secure ingest.';
