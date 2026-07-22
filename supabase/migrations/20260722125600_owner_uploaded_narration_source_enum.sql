-- PostgreSQL requires a newly added enum value to commit before a following
-- migration may use it in constraints, functions, or inserts.
alter type public.script_source_kind
  add value if not exists 'uploaded_audio_transcript';
