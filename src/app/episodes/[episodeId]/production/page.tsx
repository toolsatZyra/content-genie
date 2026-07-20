import { notFound, redirect } from "next/navigation";

import { MvpProductionStudio } from "@/components/production/mvp-production-studio";
import { getServerEnvironment } from "@/config/server-env";
import {
  createServerSupabaseClient,
  hasConfiguredSupabase,
} from "@/lib/supabase/server";

interface ProductionPageProps {
  readonly params: Promise<{ readonly episodeId: string }>;
  readonly searchParams: Promise<{ readonly fixture?: string }>;
}

export default async function ProductionPage({
  params,
  searchParams,
}: ProductionPageProps) {
  const [{ episodeId }, query] = await Promise.all([params, searchParams]);
  if (getServerEnvironment().environment === "test" && query.fixture === "mvp-review") {
    return (
      <MvpProductionStudio
        episodeId={episodeId}
        episodeTitle="The Light of Kailash"
        job={{
          attempt_number: 1,
          completed_clips: 6,
          last_error_code: null,
          last_error_summary: null,
          production_run_id: "53000000-0000-4000-8000-000000000001",
          state: "review_ready",
          total_clips: 6,
          version: 4,
        }}
        master={{
          attempt_number: 1,
          duration_ms: 91_000,
          height: 1920,
          id: "53000000-0000-4000-8000-000000000002",
          state: "pending_review",
          version: 1,
          width: 1080,
        }}
        productionRunId="53000000-0000-4000-8000-000000000001"
        signedMasterUrl="data:video/mp4;base64,AAAA"
        workspaceId="53000000-0000-4000-8000-000000000003"
      />
    );
  }
  if (!hasConfiguredSupabase()) redirect("/");

  const client = await createServerSupabaseClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect("/");

  const { data: episode } = await client
    .from("episodes")
    .select("id,title,workspace_id")
    .eq("id", episodeId)
    .maybeSingle();
  if (!episode) notFound();

  const [{ data: job }, { data: run }] = await Promise.all([
    client
      .from("mvp_production_jobs")
      .select(
        "production_run_id,state,version,attempt_number,total_clips,completed_clips,last_error_code,last_error_summary",
      )
      .eq("episode_id", episodeId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from("production_runs")
      .select("id")
      .eq("episode_id", episodeId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const { data: master } = job
    ? await client
        .from("mvp_episode_masters")
        .select("id,state,version,duration_ms,width,height,attempt_number")
        .eq("production_run_id", job.production_run_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  const { data: signedMaster } =
    master && ["pending_review", "approved"].includes(master.state)
      ? await client.storage
          .from("workspace-media")
          .createSignedUrl(
            `${episode.workspace_id}/mvp-masters/${job!.production_run_id}/${master.attempt_number}/master.mp4`,
            300,
          )
      : { data: null };

  return (
    <MvpProductionStudio
      episodeId={episode.id}
      episodeTitle={episode.title}
      job={job}
      master={master}
      productionRunId={job?.production_run_id ?? run?.id ?? null}
      signedMasterUrl={signedMaster?.signedUrl ?? null}
      workspaceId={episode.workspace_id}
    />
  );
}
