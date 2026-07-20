-- Safe member-readable projection of private evaluator consensus. Model
-- identities, prompts, and raw findings remain private.

create table public.preflight_plan_qc_summaries (
  id uuid primary key,
  workspace_id uuid not null,
  preflight_run_id uuid not null,
  plan_bundle_id uuid not null,
  rubric_key text not null,
  rubric_version text not null,
  ovs numeric(6,3) not null check(ovs between 0 and 100),
  cvp numeric(6,3) not null check(cvp between 0 and 100),
  pfs numeric(6,3) not null check(pfs between 0 and 100),
  lcr numeric(6,3) not null check(lcr between 0 and 100),
  confidence numeric(6,3) not null check(confidence between 0 and 100),
  evidence_density numeric(6,3) not null check(evidence_density between 0 and 100),
  verdict text not null check(verdict in ('pass','block','indeterminate')),
  gate_codes text[] not null,
  consensus_hash text not null check(consensus_hash~'^[a-f0-9]{64}$'),
  created_at timestamptz not null,
  unique(workspace_id,id),
  unique(plan_bundle_id,consensus_hash),
  foreign key(workspace_id,preflight_run_id)
    references public.preflight_runs(workspace_id,id) on delete restrict,
  foreign key(workspace_id,plan_bundle_id)
    references public.preflight_plan_bundles(workspace_id,id) on delete restrict
);

create or replace function private.project_plan_qc_consensus()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  insert into public.preflight_plan_qc_summaries(
    id,workspace_id,preflight_run_id,plan_bundle_id,rubric_key,rubric_version,
    ovs,cvp,pfs,lcr,confidence,evidence_density,verdict,gate_codes,consensus_hash,created_at
  ) values(new.id,new.workspace_id,new.preflight_run_id,new.plan_bundle_id,new.rubric_key,
    new.rubric_version,new.ovs,new.cvp,new.pfs,new.lcr,new.confidence,new.evidence_density,
    new.verdict,new.gate_codes,new.consensus_hash,new.created_at);
  return new;
end;
$$;

create trigger project_plan_qc_consensus_after_insert
after insert on private.preflight_plan_qc_consensus
for each row execute function private.project_plan_qc_consensus();
create trigger plan_qc_summaries_immutable before update or delete on public.preflight_plan_qc_summaries
for each row execute function private.reject_mutation();

create index plan_qc_summary_run_idx on public.preflight_plan_qc_summaries(preflight_run_id);
create index plan_qc_summary_bundle_idx on public.preflight_plan_qc_summaries(plan_bundle_id);
alter table public.preflight_plan_qc_summaries enable row level security;
alter table public.preflight_plan_qc_summaries force row level security;
create policy plan_qc_summaries_member_select on public.preflight_plan_qc_summaries
for select to authenticated using(private.is_active_member(workspace_id,(select auth.uid())));
revoke all on table public.preflight_plan_qc_summaries from public,anon,authenticated;
grant select on table public.preflight_plan_qc_summaries to authenticated;
revoke all on function private.project_plan_qc_consensus() from public,anon,authenticated;
