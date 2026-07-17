import "server-only";

import { createHash } from "node:crypto";

import { getServerEnvironment } from "@/config/server-env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { DiagnosticEvent } from "@/observability/schema";

export async function persistDiagnosticEvent(
  event: DiagnosticEvent,
  actorUserId: string | null,
): Promise<boolean> {
  const environment = getServerEnvironment();
  if (!environment.supabaseServiceRoleKey || !environment.public.supabaseUrl) {
    return false;
  }
  const dedupeHash = createHash("sha256")
    .update(
      JSON.stringify([
        event.event,
        event.occurredAt,
        event.requestId ?? "",
        event.message,
      ]),
    )
    .digest("hex");
  const client = createAdminSupabaseClient();
  const { error } = await client.rpc("record_client_diagnostic", {
    p_actor_user_id: actorUserId,
    p_correlation_id: event.requestId ?? `diagnostic_${dedupeHash.slice(0, 24)}`,
    p_dedupe_hash: dedupeHash,
    p_environment: environment.environment,
    p_event_type: event.event,
    p_occurred_at: event.occurredAt,
    p_safe_summary: event.message.slice(0, 1000),
  });
  if (error) throw error;
  return true;
}
