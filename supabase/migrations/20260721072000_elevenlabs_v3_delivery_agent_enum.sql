-- ElevenLabs V3 delivery direction is an additive, ledgered narration sidecar.
-- Keep the enum change in its own transaction so subsequent functions may use
-- the new value without PostgreSQL's unsafe-new-enum-value restriction.

alter type private.agent_tool_name
  add value if not exists 'audio.delivery';
