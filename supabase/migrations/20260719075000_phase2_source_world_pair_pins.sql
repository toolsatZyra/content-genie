-- Make the qualified cultural review and visual World an inseparable pair at
-- every durable downstream boundary. A previously approved review packet can
-- therefore never authorize a plan or release assembled against another World
-- reference pack, even if both objects are independently valid.

alter table public.source_review_packet_world_bindings
  add constraint source_review_binding_exact_pair_unique
  unique(workspace_id,source_review_packet_id,world_reference_pack_version_id);

alter table public.preflight_plan_bundles
  add constraint preflight_plan_source_world_binding_fk
  foreign key(workspace_id,source_review_packet_id,world_reference_pack_version_id)
  references public.source_review_packet_world_bindings(
    workspace_id,source_review_packet_id,world_reference_pack_version_id
  ) on delete restrict;
alter table public.series_release_components
  add constraint release_component_source_world_binding_fk
  foreign key(workspace_id,source_review_packet_id,world_reference_pack_version_id)
  references public.source_review_packet_world_bindings(
    workspace_id,source_review_packet_id,world_reference_pack_version_id
  ) on delete restrict;
