"use client";

import type { RefObject } from "react";

import { MvpProductionStudio } from "@/components/production/mvp-production-studio";
import type { CreationPreflightProjection } from "@/domain/creation-readiness";
import type { CreationProductionProjection } from "@/domain/mvp-production";

interface CreationLaunchpadProps {
  readonly episodeId: string;
  readonly episodeTitle: string;
  readonly preflight: CreationPreflightProjection;
  readonly production: CreationProductionProjection;
  readonly stageHeadingRef: RefObject<HTMLHeadingElement | null>;
  readonly workspaceId: string;
}

export function CreationLaunchpad({
  episodeId,
  episodeTitle,
  preflight,
  production,
  stageHeadingRef,
  workspaceId,
}: CreationLaunchpadProps) {
  const productionRunId =
    production.productionRunId ?? preflight.productionRun?.id ?? null;

  if (productionRunId) {
    return (
      <MvpProductionStudio
        episodeId={episodeId}
        episodeTitle={episodeTitle}
        job={production.job}
        master={production.master}
        editPackage={production.package}
        productionRunId={productionRunId}
        repair={production.repair}
        signedMasterUrl={production.signedMasterUrl}
        stageHeadingRef={stageHeadingRef}
        transcript={production.transcript}
        workspaceId={workspaceId}
      />
    );
  }

  return (
    <section className="launchpad-chamber">
      <div className="launchpad-sigil" aria-hidden="true">
        <i />
        <i />
        <span>◇</span>
      </div>
      <small>Autonomous production handoff</small>
      <h1 ref={stageHeadingRef} tabIndex={-1}>
        Monica is sealing the production baton.
      </h1>
      <p>
        The agentic AI crew is freezing the accepted cast, locations, character sheets,
        narration identity, master clock, shot graph and QC consensus. The complete cost
        forecast remains visible and recorded, but the owner-operated MVP does not pause
        at an arbitrary spend threshold.
      </p>
      <div className="world-lock-manifest">
        <div>
          <span>01</span>
          <strong>Sealed source</strong>
          <small>Exact script · voice · look</small>
        </div>
        <div>
          <span>02</span>
          <strong>Living world</strong>
          <small>Anchors · sheets · reference pack</small>
        </div>
        <div>
          <span>03</span>
          <strong>Production proof</strong>
          <small>Clock · graph · QC · cost ledger</small>
        </div>
      </div>
      <div className="launch-world-lock" aria-live="polite" role="status">
        <span aria-hidden="true">✦</span>
        <strong>Locking every verified dependency…</strong>
        <small>Atomic · durable · production-authorizing</small>
      </div>
      <p className="launchpad-note">
        No click is required. Production, editing, playback and final review remain in
        this Edit stage.
      </p>
    </section>
  );
}
