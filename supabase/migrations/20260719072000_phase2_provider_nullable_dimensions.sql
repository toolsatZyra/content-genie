-- Authenticated Nano Banana 2 canary evidence showed that successful image
-- records may carry null width/height. Those fields are untrusted hints; the
-- sandbox media probe remains the authoritative dimension source.

alter table private.provider_output_candidates
  alter column expected_width drop not null,
  alter column expected_height drop not null;

alter table private.provider_output_candidates
  drop constraint provider_output_candidates_expected_width_check,
  drop constraint provider_output_candidates_expected_height_check;

alter table private.provider_output_candidates
  add constraint provider_output_candidates_expected_width_check
    check (expected_width is null or expected_width between 1 and 32768),
  add constraint provider_output_candidates_expected_height_check
    check (expected_height is null or expected_height between 1 and 32768);
