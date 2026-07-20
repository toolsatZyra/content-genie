"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type JobState =
  | "queued"
  | "generating"
  | "rendering"
  | "review_ready"
  | "needs_repair"
  | "approved"
  | "export_ready"
  | "failed"
  | "canceled";

interface JobView {
  readonly attempt_number: number;
  readonly completed_clips: number;
  readonly last_error_code: string | null;
  readonly last_error_summary: string | null;
  readonly production_run_id: string;
  readonly state: JobState;
  readonly total_clips: number;
  readonly version: number;
}

interface MasterView {
  readonly attempt_number: number;
  readonly duration_ms: number;
  readonly height: number;
  readonly id: string;
  readonly state: "approved" | "pending_review" | "rejected" | "superseded";
  readonly version: number;
  readonly width: number;
}

interface StudioProps {
  readonly episodeId: string;
  readonly episodeTitle: string;
  readonly job: JobView | null;
  readonly master: MasterView | null;
  readonly productionRunId: string | null;
  readonly signedMasterUrl: string | null;
  readonly workspaceId: string;
}

const activeStates: readonly JobState[] = ["queued", "generating", "rendering"];

function stateCopy(state: JobState | undefined): {
  detail: string;
  eyebrow: string;
  title: string;
} {
  if (state === "generating") {
    return {
      detail: "The selected world anchors are becoming a bounded set of motion clips.",
      eyebrow: "Production in motion",
      title: "The scenes are taking breath.",
    };
  }
  if (state === "rendering") {
    return {
      detail:
        "Genie is assembling the locked narration and generated scenes into the vertical master.",
      eyebrow: "Final assembly",
      title: "Picture and voice are becoming one.",
    };
  }
  if (state === "review_ready") {
    return {
      detail:
        "Watch the entire film, confirm cultural integrity, then make the final release decision.",
      eyebrow: "Owner review",
      title: "Your Episode is ready to watch.",
    };
  }
  if (state === "needs_repair") {
    return {
      detail:
        "Your feedback is sealed. One bounded regeneration is available for this MVP.",
      eyebrow: "Revision requested",
      title: "Send the film back once.",
    };
  }
  if (state === "export_ready" || state === "approved") {
    return {
      detail: "The approved 9:16 master is ready to download.",
      eyebrow: "Release ready",
      title: "The final film is yours.",
    };
  }
  if (state === "failed") {
    return {
      detail:
        "Production paused with a recorded application error. No silent substitution was made.",
      eyebrow: "Production paused",
      title: "This run needs attention.",
    };
  }
  return {
    detail: "The production run is queued. You can leave this page and return later.",
    eyebrow: "World locked",
    title: "Monica is gathering the agentic AI crew.",
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
  productionRunId,
  signedMasterUrl,
  workspaceId,
}: StudioProps) {
  const router = useRouter();
  const startAttempted = useRef(false);
  const [busy, setBusy] = useState(false);
  const [culturalConfirmed, setCulturalConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [finalConfirmed, setFinalConfirmed] = useState(false);
  const copy = stateCopy(job?.state);

  useEffect(() => {
    if (job || !productionRunId || startAttempted.current) return;
    startAttempted.current = true;
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
    if (!job || !activeStates.includes(job.state)) return;
    const timer = window.setInterval(() => router.refresh(), 12_000);
    return () => window.clearInterval(timer);
  }, [job, router]);

  async function review(decision: "approve" | "reject") {
    if (!master) return;
    if (decision === "reject" && feedback.trim().length < 1) {
      setError("Add a short note describing what should change.");
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

  async function retry() {
    if (!job) return;
    setBusy(true);
    setError("");
    try {
      await command(episodeId, {
        action: "retry",
        expectedVersion: job.version,
        productionRunId: job.production_run_id,
        workspaceId,
      });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The retry could not start.");
    } finally {
      setBusy(false);
    }
  }

  const canReview = job?.state === "review_ready" && master?.state === "pending_review";
  const approved = job?.state === "export_ready" || master?.state === "approved";

  return (
    <main className="production-room">
      <nav>
        <Link href={`/episodes/${episodeId}/create?resumeCreation=create`}>
          ← Creation studio
        </Link>
        <span>Genie by Zyra</span>
      </nav>
      <header className="production-room-heading">
        <span className="eyebrow">{copy.eyebrow}</span>
        <h1>{copy.title}</h1>
        <p>{copy.detail}</p>
        <small>{episodeTitle}</small>
      </header>

      {job ? (
        <section className="production-progress" aria-live="polite">
          <div>
            <small>Run state</small>
            <strong>{job.state.replaceAll("_", " ")}</strong>
          </div>
          <div>
            <small>Attempt</small>
            <strong>{job.attempt_number} / 2</strong>
          </div>
          <div>
            <small>Scenes ready</small>
            <strong>
              {job.completed_clips} / {job.total_clips || "—"}
            </strong>
          </div>
        </section>
      ) : productionRunId ? (
        <p className="production-room-status" role="status">
          Starting production…
        </p>
      ) : (
        <p className="production-room-error" role="alert">
          This Episode does not have a locked production run yet.
        </p>
      )}

      {signedMasterUrl ? (
        <section className="master-review-player">
          <video controls playsInline preload="metadata" src={signedMasterUrl} />
          <button onClick={() => router.refresh()} type="button">
            Refresh private preview
          </button>
        </section>
      ) : canReview || approved ? (
        <p className="production-room-status" role="status">
          Opening the private master…
        </p>
      ) : null}

      {canReview ? (
        <section className="master-review-panel">
          <div>
            <span className="eyebrow">Two confirmations · one decision</span>
            <h2>Release authority stays with you.</h2>
          </div>
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
          <label className="master-review-feedback">
            <span>Revision note (required only when sending back)</span>
            <textarea
              maxLength={4000}
              onChange={(event) => setFeedback(event.target.value)}
              placeholder="Describe the single most important change."
              rows={4}
              value={feedback}
            />
          </label>
          <div className="master-review-actions">
            <button
              className="creation-secondary"
              disabled={busy || feedback.trim().length < 1}
              onClick={() => void review("reject")}
              type="button"
            >
              Send back once
            </button>
            <button
              className="creation-primary"
              disabled={busy || !culturalConfirmed || !finalConfirmed}
              onClick={() => void review("approve")}
              type="button"
            >
              {busy ? "Saving decision…" : "Approve final film"}
            </button>
          </div>
        </section>
      ) : null}

      {job?.state === "needs_repair" ? (
        <section className="production-retry-panel">
          <p>
            The rejected master is preserved as evidence. A fresh bounded attempt will
            reuse the locked script, voice, look and world.
          </p>
          <button
            className="creation-primary"
            disabled={busy || job.attempt_number >= 2}
            onClick={() => void retry()}
            type="button"
          >
            {busy ? "Starting retry…" : "Generate final retry"}
          </button>
        </section>
      ) : null}

      {approved && signedMasterUrl ? (
        <a className="production-download" download href={signedMasterUrl}>
          Download approved MP4
        </a>
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
    </main>
  );
}
