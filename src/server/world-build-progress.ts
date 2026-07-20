import "server-only";

import { createHash } from "node:crypto";

import type { WorldExtraction } from "@/domain/agent/world-extraction";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

type WorldProgressKind = "character" | "location" | "prop" | "system";

export function worldProgressItemKey(
  prefix: Exclude<WorldProgressKind, "system">,
  key: string,
): string {
  const clean = key
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/gu, "-")
    .slice(0, 96);
  const hash = createHash("sha256").update(`${prefix}:${key}`).digest("hex");
  return `${prefix}.${clean}.${hash.slice(0, 12)}`;
}

async function upsert(rows: readonly Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await createAdminSupabaseClient()
    .from("world_build_progress_items")
    .upsert(rows, { onConflict: "configuration_candidate_id,item_key" });
  if (error) throw new Error("World progress could not be projected.");
}

export async function beginWorldBuildProgress(
  input: Readonly<{
    configurationCandidateId: string;
    preflightRunId: string;
    workspaceId: string;
  }>,
): Promise<void> {
  await upsert([
    {
      configuration_candidate_id: input.configurationCandidateId,
      display_name: "Reading the locked script",
      item_key: "system.extraction",
      item_kind: "system",
      preflight_run_id: input.preflightRunId,
      safe_detail: "Detecting characters, locations and significant visual props",
      sort_order: 0,
      state: "extracting",
      updated_at: new Date().toISOString(),
      workspace_id: input.workspaceId,
    },
  ]);
}

export async function projectWorldExtractionProgress(
  input: Readonly<{
    configurationCandidateId: string;
    extraction: WorldExtraction;
    preflightRunId: string;
    workspaceId: string;
  }>,
): Promise<void> {
  const now = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];
  let order = 100;
  for (const character of input.extraction.characters) {
    for (const form of character.forms) {
      rows.push({
        configuration_candidate_id: input.configurationCandidateId,
        display_name:
          form.displayName === character.displayName
            ? character.displayName
            : `${character.displayName} · ${form.displayName}`,
        item_key: worldProgressItemKey(
          "character",
          `${character.canonicalKey}.${form.formKey}`,
        ),
        item_kind: "character",
        preflight_run_id: input.preflightRunId,
        safe_detail: "Identity detected; writing the visual anchor prompt",
        sort_order: order,
        state: "identified",
        updated_at: now,
        workspace_id: input.workspaceId,
      });
      order += 1;
    }
  }
  order = 300;
  for (const location of input.extraction.locations) {
    rows.push({
      configuration_candidate_id: input.configurationCandidateId,
      display_name: location.displayName,
      item_key: worldProgressItemKey("location", location.canonicalKey),
      item_kind: "location",
      preflight_run_id: input.preflightRunId,
      safe_detail: location.researchRequired
        ? "Location detected; preparing factual reference research"
        : "Location detected; writing the visual anchor prompt",
      sort_order: order,
      state: location.researchRequired ? "researching" : "identified",
      updated_at: now,
      workspace_id: input.workspaceId,
    });
    order += 1;
  }
  order = 500;
  for (const prop of input.extraction.props) {
    rows.push({
      configuration_candidate_id: input.configurationCandidateId,
      display_name: prop.displayName,
      item_key: worldProgressItemKey("prop", prop.canonicalKey),
      item_kind: "prop",
      preflight_run_id: input.preflightRunId,
      safe_detail: "Significant prop detected; writing its continuity prompt",
      sort_order: order,
      state: "identified",
      updated_at: now,
      workspace_id: input.workspaceId,
    });
    order += 1;
  }
  rows.push({
    configuration_candidate_id: input.configurationCandidateId,
    display_name: "Script analysis complete",
    item_key: "system.extraction",
    item_kind: "system",
    preflight_run_id: input.preflightRunId,
    safe_detail: `${rows.length} visual anchors identified from the locked script`,
    sort_order: 0,
    state: "identified",
    updated_at: now,
    workspace_id: input.workspaceId,
  });
  await upsert(rows);
}

export async function failWorldBuildProgress(
  input: Readonly<{
    detail: string;
    preflightRunId: string;
  }>,
): Promise<void> {
  const { error } = await createAdminSupabaseClient()
    .from("world_build_progress_items")
    .update({
      safe_detail: input.detail,
      state: "failed",
      updated_at: new Date().toISOString(),
    })
    .eq("preflight_run_id", input.preflightRunId)
    .neq("state", "review_ready");
  if (error) throw new Error("World progress failure could not be projected.");
}

export async function resumeWorldBuildProgress(
  input: Readonly<{ preflightRunId: string }>,
): Promise<void> {
  const { error } = await createAdminSupabaseClient()
    .from("world_build_progress_items")
    .update({
      safe_detail: "Retrying locked-script extraction with fresh worker authority",
      state: "extracting",
      updated_at: new Date().toISOString(),
    })
    .eq("preflight_run_id", input.preflightRunId)
    .eq("item_kind", "system");
  if (error) throw new Error("World retry progress could not be projected.");
}
