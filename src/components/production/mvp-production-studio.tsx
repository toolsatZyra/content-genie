"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type RefObject } from "react";

import type {
  MvpEditPackageView,
  MvpMasterView,
  MvpProductionJobState,
  MvpProductionJobView,
  MvpRepairProgressView,
} from "@/domain/mvp-production";

interface StudioProps {
  readonly episodeId: string;
  readonly episodeTitle: string;
  readonly job: MvpProductionJobView | null;
  readonly master: MvpMasterView | null;
  readonly editPackage: MvpEditPackageView | null;
  readonly productionRunId: string | null;
  readonly repair: MvpRepairProgressView | null;
  readonly signedMasterUrl: string | null;
  readonly stageHeadingRef: RefObject<HTMLHeadingElement | null>;
  readonly workspaceId: string;
}

interface SignedAssetResponse {
  readonly ok?: boolean;
  readonly signedUrl?: string;
}

const activeStates: readonly MvpProductionJobState[] = [
  "queued",
  "repair_planning",
  "generating",
  "sound_designing",
  "rendering",
  "needs_repair",
];

function repairActionLabel(
  action: MvpRepairProgressView["feedback_points"][number]["actions"][number]["selectedAction"],
) {
  if (action === "storyboard_and_clip") return "Storyboard + clip";
  if (action === "clip_only") return "Clip only";
  return "Re-edit";
}

function repairAssetStatusLabel(
  status: MvpRepairProgressView["feedback_points"][number]["actions"][number]["assetStatus"],
) {
  return status === "selected_complete_assets"
    ? "complete replacement assets selected"
    : "planned; no replacement selected yet";
}

function repairResolutionLabel(
  resolution: MvpRepairProgressView["feedback_points"][number]["resolution"],
) {
  if (resolution === "clarification") return "Needs clarification";
  if (resolution === "deterministic") return "Mapped from timestamp or shot";
  return "Mapped by Monica";
}

function stateCopy(state: MvpProductionJobState | undefined): {
  detail: string;
  eyebrow: string;
  title: string;
} {
  if (state === "generating") {
    return {
      detail:
        "Storyboard frames and motion clips are arriving shot by shot against the narration clock.",
      eyebrow: "Edit in progress",
      title: "The film is taking shape.",
    };
  }
  if (state === "rendering") {
    return {
      detail:
        "The Editor and Sound Director are executing the cut, transitions, narration and mix.",
      eyebrow: "Final edit",
      title: "Picture and sound are becoming one.",
    };
  }
  if (state === "sound_designing") {
    return {
      detail:
        "The Sound Director is creating only the locked Foley cues, preserving deliberate silence, and preparing the narration-safe mix.",
      eyebrow: "Sound design",
      title: "The film is finding its pulse.",
    };
  }
  if (state === "review_ready") {
    return {
      detail:
        "Watch the edited film here. Approve it, download it, or tell Monica what should change.",
      eyebrow: "Owner review",
      title: "Your Episode is ready to watch.",
    };
  }
  if (state === "needs_repair") {
    return {
      detail:
        "Monica is interpreting your feedback and opening a preserved repair attempt automatically.",
      eyebrow: "Repair in progress",
      title: "Monica is revising the cut.",
    };
  }
  if (state === "repair_planning") {
    return {
      detail:
        "Monica is interpreting the exact feedback, locating the minimum affected shot set, and preserving everything else.",
      eyebrow: "Repair analysis",
      title: "Monica is mapping the repair.",
    };
  }
  if (state === "export_ready" || state === "approved") {
    return {
      detail:
        "The approved master is ready. Genie is also preparing the exact images and clips used in the edit.",
      eyebrow: "Approved",
      title: "The final film is yours.",
    };
  }
  if (state === "failed") {
    return {
      detail:
        "The run stopped with a recorded application error. Its completed work and prior master remain preserved.",
      eyebrow: "Edit paused",
      title: "This run needs attention.",
    };
  }
  return {
    detail:
      "The Director, storyboard, motion, edit and QC agents will report real work here as it completes.",
    eyebrow: "Autonomous edit",
    title: "Monica is gathering the agentic AI crew.",
  };
}

function activeAgent(
  state: MvpProductionJobState | undefined,
  attempt: number,
  repairState: MvpRepairProgressView["state"] | undefined,
) {
  if (repairState === "awaiting_clarification") {
    return {
      detail: "Waiting for one exact answer before choosing or regenerating a shot",
      name: "Monica · Repair Director",
      step: "Repair sequence · clarification",
    };
  }
  if (
    state === "needs_repair" ||
    state === "repair_planning" ||
    (attempt > 1 && state === "queued")
  ) {
    return {
      detail:
        "Reading the feedback, locating affected shots and preserving the untouched base master",
      name: "Monica · Repair Director",
      step: "Repair sequence · interpretation",
    };
  }
  if (state === "generating") {
    return {
      detail: "Creating and securing the next storyboard or motion asset",
      name: "Storyboard + Motion Crew",
      step: "Edit sequence · asset production",
    };
  }
  if (state === "rendering") {
    return {
      detail: "Executing the locked edit, sound mix and final render-integrity checks",
      name: "Editor + Monica · Technical QC",
      step: "Edit sequence · assembly",
    };
  }
  if (state === "sound_designing") {
    return {
      detail: "Generating and validating the next exact narration-safe SFX cue",
      name: "Sound Director",
      step: "Edit sequence · sound design",
    };
  }
  if (state === "review_ready") {
    return {
      detail: "The exact current master is waiting for your decision",
      name: "Monica · Quality Director",
      step: "Edit sequence · owner review",
    };
  }
  if (state === "export_ready" || state === "approved") {
    return {
      detail: "Keeping the approved master and its exact edit assets ready to download",
      name: "Release + Archive Agent",
      step: "Edit sequence · approved handoff",
    };
  }
  if (state === "failed") {
    return {
      detail: "Preserving completed work and reporting the exact recovery point",
      name: "Monica · Recovery Director",
      step: "Edit sequence · recovery",
    };
  }
  return {
    detail: "Preparing the shot, storyboard and edit work queue",
    name: "Story + Shot Directors",
    step: "Edit sequence · planning",
  };
}

async function command(episodeId: string, body: Record<string, unknown>) {
  const response = await fetch(`/api/episodes/${episodeId}/mvp-production`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const result = (await response.json()) as {
    code?: string;
    message?: string;
    ok?: boolean;
  };
  if (!response.ok || !result.ok) {
    throw new Error(result.message ?? result.code ?? "Production command failed.");
  }
}

export function MvpProductionStudio({
  episodeId,
  episodeTitle,
  job,
  master,
  editPackage,
  productionRunId,
  repair,
  signedMasterUrl,
  stageHeadingRef,
  workspaceId,
}: StudioProps) {
  const router = useRouter();
  const startAttempted = useRef<string | null>(null);
  const repairAttempted = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clarificationAnswer, setClarificationAnswer] = useState("");
  const [culturalConfirmed, setCulturalConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [finalConfirmed, setFinalConfirmed] = useState(false);
  const [signedMasterAsset, setSignedMasterAsset] = useState<{
    objectName: string;
    url: string;
  } | null>(null);
  const [signedPackageAsset, setSignedPackageAsset] = useState<{
    objectName: string;
    url: string;
  } | null>(null);
  const [previewNonce, setPreviewNonce] = useState(0);
  const copy = stateCopy(job?.state);
  const agent = activeAgent(job?.state, job?.attempt_number ?? 1, repair?.state);
  const masterUrl =
    signedMasterUrl ??
    (signedMasterAsset?.objectName === master?.object_name
      ? (signedMasterAsset?.url ?? null)
      : null);
  const packageUrl =
    signedPackageAsset?.objectName === editPackage?.object_name
      ? (signedPackageAsset?.url ?? null)
      : null;

  useEffect(() => {
    if (job || !productionRunId || startAttempted.current === productionRunId) return;
    startAttempted.current = productionRunId;
    void command(episodeId, {
      action: "start",
      productionRunId,
      workspaceId,
    })
      .then(() => router.refresh())
      .catch((caught: unknown) =>
        setError(
          caught instanceof Error ? caught.message : "Production could not start.",
        ),
      );
  }, [episodeId, job, productionRunId, router, workspaceId]);

  useEffect(() => {
    if (
      (!job || !activeStates.includes(job.state)) &&
      editPackage?.state !== "queued" &&
      editPackage?.state !== "building"
    )
      return;
    const timer = window.setInterval(() => router.refresh(), 4_000);
    return () => window.clearInterval(timer);
  }, [editPackage?.state, job, router]);

  useEffect(() => {
    if (!job || job.state !== "needs_repair") return;
    const attemptKey = `${job.production_run_id}:${job.version}`;
    if (repairAttempted.current === attemptKey) return;
    repairAttempted.current = attemptKey;
    setBusy(true);
    setError("");
    void command(episodeId, {
      action: "retry",
      expectedVersion: job.version,
      productionRunId: job.production_run_id,
      workspaceId,
    })
      .then(() => router.refresh())
      .catch((caught: unknown) => {
        repairAttempted.current = null;
        setError(
          caught instanceof Error ? caught.message : "The repair could not start.",
        );
      })
      .finally(() => setBusy(false));
  }, [episodeId, job, router, workspaceId]);

  useEffect(() => {
    if (signedMasterUrl || !master?.object_name) return;
    const abortController = new AbortController();
    void fetch("/api/storage/sign", {
      body: JSON.stringify({
        bucket: "workspace-media",
        expiresIn: 120,
        path: master.object_name,
      }),
      cache: "no-store",
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: abortController.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as SignedAssetResponse;
        if (!response.ok || body.ok !== true || typeof body.signedUrl !== "string") {
          throw new Error("The private master could not be opened.");
        }
        setSignedMasterAsset({
          objectName: master.object_name,
          url: body.signedUrl,
        });
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(
          caught instanceof Error
            ? caught.message
            : "The private master is unavailable.",
        );
      });
    return () => abortController.abort();
  }, [master?.id, master?.object_name, master?.version, previewNonce, signedMasterUrl]);

  useEffect(() => {
    if (editPackage?.state !== "ready" || !editPackage.object_name) return;
    const abortController = new AbortController();
    void fetch("/api/storage/sign", {
      body: JSON.stringify({
        bucket: "workspace-media",
        expiresIn: 120,
        path: editPackage.object_name,
      }),
      cache: "no-store",
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: abortController.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as SignedAssetResponse;
        if (!response.ok || body.ok !== true || typeof body.signedUrl !== "string") {
          throw new Error("The approved images and clips package could not be opened.");
        }
        setSignedPackageAsset({
          objectName: editPackage.object_name!,
          url: body.signedUrl,
        });
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(
          caught instanceof Error
            ? caught.message
            : "The approved images and clips package is unavailable.",
        );
      });
    return () => abortController.abort();
  }, [
    editPackage?.id,
    editPackage?.object_name,
    editPackage?.state,
    editPackage?.version,
  ]);

  async function review(decision: "approve" | "reject") {
    if (!master) return;
    if (decision === "reject" && feedback.trim().length < 1) {
      setError("Tell Monica what should change before requesting repairs.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await command(episodeId, {
        action: "review",
        culturalReviewConfirmed: culturalConfirmed,
        decision,
        expectedVersion: master.version,
        feedback: feedback.trim(),
        finalReviewConfirmed: finalConfirmed,
        masterId: master.id,
        workspaceId,
      });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The review was not saved.");
    } finally {
      setBusy(false);
    }
  }

  async function answerClarification() {
    if (
      !repair ||
      repair.state !== "awaiting_clarification" ||
      !repair.clarification_id ||
      clarificationAnswer.trim().length < 1
    ) {
      setError("Answer Monica's question before continuing the repair.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await command(episodeId, {
        action: "clarify",
        answer: clarificationAnswer.trim(),
        clarificationId: repair.clarification_id,
        expectedVersion: repair.version,
        repairRequestId: repair.id,
        workspaceId,
      });
      setClarificationAnswer("");
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The clarification answer was not saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  const canReview = job?.state === "review_ready" && master?.state === "pending_review";
  const approved = job?.state === "export_ready" || master?.state === "approved";

  return (
    <section className="edit-room">
      <header className="production-room-heading">
        <span className="eyebrow">{copy.eyebrow}</span>
        <h1 ref={stageHeadingRef} tabIndex={-1}>
          {copy.title}
        </h1>
        <p>{copy.detail}</p>
        <small>{episodeTitle}</small>
      </header>

      <aside className="edit-agent-progress" aria-live="polite">
        <span className="agent-activity-orbit" aria-hidden="true">
          <i />
          <i />
          <strong>AI</strong>
        </span>
        <span>
          <small>{agent.step}</small>
          <strong>{agent.name}</strong>
          <em>{agent.detail}</em>
        </span>
      </aside>

      {job ? (
        <section className="production-progress" aria-live="polite">
          <div>
            <small>Run state</small>
            <strong>{job.state.replaceAll("_", " ")}</strong>
          </div>
          <div>
            <small>Edit attempt</small>
            <strong>{job.attempt_number}</strong>
          </div>
          <div>
            <small>Storyboards ready</small>
            <strong>
              {job.completed_storyboards} / {job.total_storyboards || "—"}
            </strong>
          </div>
          <div>
            <small>Shots ready</small>
            <strong>
              {job.completed_clips} / {job.total_clips || "—"}
            </strong>
          </div>
          <div>
            <small>Sound cues ready</small>
            <strong>
              {job.completed_sfx} / {job.total_sfx || "—"}
            </strong>
          </div>
        </section>
      ) : productionRunId ? (
        <p className="production-room-status" role="status">
          Starting the autonomous edit…
        </p>
      ) : (
        <p className="production-room-error" role="alert">
          This Episode does not have a locked production run yet.
        </p>
      )}

      {repair ? (
        <section className="repair-intelligence-panel" aria-live="polite">
          <header>
            <span className="eyebrow">Monica · repair intelligence</span>
            <h2>
              {repair.state === "analyzing"
                ? "Reading your feedback shot by shot."
                : repair.state === "awaiting_clarification"
                  ? "Monica needs one precise detail."
                  : repair.state === "complete"
                    ? "The selected repairs are assembled."
                    : "Repairing only what the feedback requires."}
            </h2>
            <p>
              Attempt {repair.target_attempt_number ?? job?.attempt_number ?? 1} ·{" "}
              {repair.state.replaceAll("_", " ")}
            </p>
          </header>
          {repair.feedback_points.length > 0 ? (
            <ol className="repair-feedback-story" aria-label="Repair feedback mapping">
              {repair.feedback_points.map((point) => (
                <li key={point.feedbackPointIndex}>
                  <div>
                    <strong>Feedback point {point.feedbackPointIndex}</strong>
                    <span>{repairResolutionLabel(point.resolution)}</span>
                  </div>
                  <p>
                    {point.mappedShots.length > 0
                      ? `Mapped to shot${point.mappedShots.length === 1 ? "" : "s"} ${point.mappedShots.join(", ")}.`
                      : "No shot or production action is selected yet."}
                  </p>
                  {point.actions.length > 0 ? (
                    <div className="repair-action-story">
                      {point.actions.map((action) => (
                        <small key={`${action.shotNumber}-${action.selectedAction}`}>
                          Shot {action.shotNumber} ·{" "}
                          {repairActionLabel(action.selectedAction)} ·{" "}
                          {repairAssetStatusLabel(action.assetStatus)}
                        </small>
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
          {repair.state === "awaiting_clarification" &&
          repair.clarification_question ? (
            <form
              className="repair-clarification"
              onSubmit={(event) => {
                event.preventDefault();
                void answerClarification();
              }}
            >
              <p>{repair.clarification_question}</p>
              <label htmlFor={`repair-clarification-${repair.id}`}>
                <span>Your answer</span>
                <textarea
                  id={`repair-clarification-${repair.id}`}
                  maxLength={4_000}
                  onChange={(event) => setClarificationAnswer(event.target.value)}
                  placeholder="Name the timestamp or shot and describe exactly what should change."
                  rows={3}
                  value={clarificationAnswer}
                />
              </label>
              <button
                className="primary-button"
                disabled={busy || clarificationAnswer.trim().length < 1}
                type="submit"
              >
                {busy ? "Saving answer…" : "Continue repair"}
              </button>
            </form>
          ) : repair.total_shots > 0 ? (
            <div className="repair-intelligence-grid">
              <span>
                <small>Affected shots</small>
                <strong>
                  {repair.affected_shots} / {repair.total_shots}
                </strong>
              </span>
              <span>
                <small>Boards preserved</small>
                <strong>{repair.storyboards_reused}</strong>
              </span>
              <span>
                <small>Boards rebuilt</small>
                <strong>
                  {repair.storyboards_regenerated} / {repair.storyboards_to_regenerate}
                </strong>
              </span>
              <span>
                <small>Clips preserved</small>
                <strong>{repair.clips_reused}</strong>
              </span>
              <span>
                <small>Clips rebuilt</small>
                <strong>
                  {repair.clips_regenerated} / {repair.clips_to_regenerate}
                </strong>
              </span>
              <span>
                <small>Edit selections locked</small>
                <strong>
                  {repair.shots_selected} / {repair.total_shots}
                </strong>
              </span>
            </div>
          ) : (
            <p>
              Monica is locating the smallest affected shot set. The prior master and
              every untouched asset remain preserved.
            </p>
          )}
          {repair.last_error_summary ? (
            <p role="alert">
              {repair.last_error_summary} <small>{repair.last_error_code}</small>
            </p>
          ) : null}
        </section>
      ) : null}

      {masterUrl ? (
        <section className="master-review-player">
          <video controls playsInline preload="metadata" src={masterUrl} />
          <div className="master-download-row">
            <button onClick={() => setPreviewNonce((value) => value + 1)} type="button">
              Refresh private preview
            </button>
            <a download href={masterUrl}>
              Download current video
            </a>
          </div>
        </section>
      ) : canReview || approved ? (
        <p className="production-room-status" role="status">
          Opening the private master…
        </p>
      ) : null}

      {canReview ? (
        <section className="master-review-panel">
          <div>
            <span className="eyebrow">Your decision</span>
            <h2>Approve the film or ask Monica to repair it.</h2>
          </div>
          <label className="master-review-feedback">
            <span>Feedback for Monica</span>
            <textarea
              maxLength={4000}
              onChange={(event) => setFeedback(event.target.value)}
              placeholder="Describe what feels wrong and what you want changed. Monica will locate the affected shots and preserve everything else."
              rows={5}
              value={feedback}
            />
          </label>
          <label className="master-review-check">
            <input
              checked={culturalConfirmed}
              onChange={(event) => setCulturalConfirmed(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>Cultural integrity confirmed</strong>
              <small>
                Deities, iconography, places, pronunciation and devotional tone are
                respectful.
              </small>
            </span>
          </label>
          <label className="master-review-check">
            <input
              checked={finalConfirmed}
              onChange={(event) => setFinalConfirmed(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>Final film confirmed</strong>
              <small>
                Picture, narration, pacing and 9:16 presentation are ready to release.
              </small>
            </span>
          </label>
          <div className="master-review-actions">
            <button
              className="creation-secondary"
              disabled={busy || feedback.trim().length < 1}
              onClick={() => void review("reject")}
              type="button"
            >
              {busy ? "Sending feedback…" : "Request repairs"}
            </button>
            <button
              className="creation-primary"
              disabled={busy || !culturalConfirmed || !finalConfirmed}
              onClick={() => void review("approve")}
              type="button"
            >
              {busy ? "Saving decision…" : "Approve video"}
            </button>
          </div>
        </section>
      ) : null}

      {job?.state === "needs_repair" ? (
        <section className="production-retry-panel" aria-live="polite">
          <span className="eyebrow">Monica is working</span>
          <h2>Turning your feedback into a repair plan.</h2>
          <p>
            The current master and every used asset remain untouched. Monica is opening
            the next preserved attempt automatically, then this same screen will show
            its boards, clips, edit and QC progress.
          </p>
        </section>
      ) : null}

      {approved ? (
        <section className="approved-downloads">
          <div>
            <span className="eyebrow">Manual edit handoff</span>
            <h2>Every used image and clip stays available.</h2>
            <p>
              Genie is preparing one verified package containing the approved master,
              all storyboard images, all clips used in the edit, a manifest and
              checksums.
            </p>
          </div>
          {packageUrl ? (
            <a download="genie-approved-images-and-clips.zip" href={packageUrl}>
              Download all images + clips
            </a>
          ) : editPackage?.state === "failed" ? (
            <p role="alert">
              Package preparation stopped safely. {editPackage.last_error_summary}
            </p>
          ) : (
            <button disabled type="button">
              {editPackage?.state === "building"
                ? "Packaging images + clips"
                : "Preparing images + clips"}
            </button>
          )}
        </section>
      ) : null}

      {job?.last_error_summary ? (
        <p className="production-room-error" role="alert">
          {job.last_error_summary} <small>{job.last_error_code}</small>
        </p>
      ) : null}
      {error ? (
        <p className="production-room-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
