-- A repair attempt owns a fresh storyboard and clip sequence. Preserve prior
-- attempts, but reset the aggregate counters shown to the owner.

do $migration$
declare
  definition text;
  revised text;
begin
  definition := pg_get_functiondef(
    'public.command_retry_mvp_production(uuid,uuid,bigint)'::regprocedure
  );
  revised := replace(
    definition,
    'total_clips = 0, completed_clips = 0,',
    'total_storyboards = 0, completed_storyboards = 0, total_clips = 0, completed_clips = 0,'
  );
  if revised = definition then
    raise exception 'MVP retry storyboard-progress patch target was not found';
  end if;
  execute revised;
end;
$migration$;
