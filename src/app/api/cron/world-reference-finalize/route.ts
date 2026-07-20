import { NextResponse } from "next/server";

import {
  getSecureIngestCronEnvironment,
  hasValidCronAuthorization,
  SecureIngestCronEnvironmentError,
} from "@/config/secure-ingest-cron-env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  ensureSourceCulturalPacket,
  SourceCulturalPreflightError,
} from "@/server/source-cultural-preflight";
import {
  ensureNarrationClockRun,
  PreflightAutoReconcilerError,
} from "@/server/preflight-auto-reconciler";
import {
  ensureWorldReferencePack,
  WorldReferencePackError,
} from "@/server/world-reference-pack";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const runtime = "nodejs";

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
    status,
  });
}

export async function GET(request: Request) {
  try {
    const environment = getSecureIngestCronEnvironment();
    if (!hasValidCronAuthorization(request.headers, environment.cronSecret)) {
      return response({ code: "CRON_AUTHORITY_REJECTED", ok: false }, 401);
    }
    const client = createAdminSupabaseClient();
    const { data, error } = await client
      .from("episode_configuration_candidates")
      .select("id,workspace_id")
      .in("state", ["world_design", "preflight", "ready_to_lock"])
      .order("updated_at", { ascending: true })
      .limit(10);
    if (error) throw new WorldReferencePackError("World queue is unavailable.");
    let finalized = 0;
    let sourceReady = 0;
    let sourceWaiting = 0;
    let narrationQueued = 0;
    let narrationWaiting = 0;
    let waiting = 0;
    for (const candidate of data ?? []) {
      const result = await ensureWorldReferencePack({
        configurationCandidateId: candidate.id,
        workspaceId: candidate.workspace_id,
      });
      if (result.ready && result.packId) {
        finalized += 1;
        let sourceSucceeded = false;
        try {
          await ensureSourceCulturalPacket({
            configurationCandidateId: candidate.id,
            workspaceId: candidate.workspace_id,
            worldReferencePackVersionId: result.packId,
          });
          sourceReady += 1;
          sourceSucceeded = true;
        } catch {
          sourceWaiting += 1;
        }
        if (!sourceSucceeded) continue;
        try {
          const narration = await ensureNarrationClockRun({
            configurationCandidateId: candidate.id,
            workspaceId: candidate.workspace_id,
          });
          if (narration.shouldTrigger && narration.preflightRunId) {
            narrationQueued += 1;
          } else if (narration.state === "waiting_source_review") {
            narrationWaiting += 1;
          }
        } catch {
          narrationWaiting += 1;
        }
      } else waiting += 1;
    }
    return response(
      {
        finalized,
        inspected: data?.length ?? 0,
        narrationQueued,
        narrationWaiting,
        ok: true,
        sourceReady,
        sourceWaiting,
        waiting,
      },
      200,
    );
  } catch (error) {
    if (error instanceof SecureIngestCronEnvironmentError) {
      return response({ code: "CRON_DISABLED", ok: false }, 503);
    }
    if (
      error instanceof WorldReferencePackError ||
      error instanceof SourceCulturalPreflightError ||
      error instanceof PreflightAutoReconcilerError
    ) {
      return response({ code: "WORLD_REFERENCE_RETRY", ok: false }, 503);
    }
    return response({ code: "WORLD_REFERENCE_UNAVAILABLE", ok: false }, 503);
  }
}
