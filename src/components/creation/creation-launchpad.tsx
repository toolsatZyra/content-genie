"use client";

import Link from "next/link";
import type { RefObject } from "react";

import type { CreationPreflightProjection } from "@/domain/creation-readiness";

interface CreationLaunchpadProps {
  readonly canEdit: boolean;
  readonly episodeId: string;
  readonly onLock: () => void;
  readonly preflight: CreationPreflightProjection;
  readonly stageHeadingRef: RefObject<HTMLHeadingElement | null>;
  readonly working: boolean;
  readonly worldReady: boolean;
}

function usd(microusd: number): string {
  return `$${(microusd / 1_000_000).toFixed(2)}`;
}

export function CreationLaunchpad({
  canEdit,
  episodeId,
  onLock,
  preflight,
  stageHeadingRef,
  working,
  worldReady,
}: CreationLaunchpadProps) {
  const run = preflight.productionRun;
  const readyToLock =
    worldReady &&
    preflight.failure === null &&
    preflight.sourceReview?.status === "approved" &&
    preflight.audioIdentity?.state === "verified" &&
    preflight.masterClock?.state === "verified" &&
    preflight.plan?.state === "qc_passed" &&
    preflight.qc?.verdict === "pass" &&
    preflight.quote?.confirmed === true &&
    preflight.quote.expired === false;

  if (run) {
    return (
      <section className="launchpad-chamber is-running">
        <div className="launchpad-sigil" aria-hidden="true">
          <i />
          <i />
          <span>✦</span>
        </div>
        <small>
          World Lock sealed · run {run.runNumber.toString().padStart(2, "0")}
        </small>
        <h1 ref={stageHeadingRef} tabIndex={-1}>
          Monica has the baton.
        </h1>
        <p>
          Every creative and financial input is pinned to manifest{" "}
          <code>{run.manifestHash.slice(0, 12)}</code>. Production can advance
          asynchronously without changing the world you approved.
        </p>
        <div className="launchpad-run-status">
          <div>
            <small>Run state</small>
            <strong>{run.state.replaceAll("_", " ")}</strong>
          </div>
          <div>
            <small>Authorized high</small>
            <strong>{usd(run.authorizedHighMicrousd)}</strong>
          </div>
          <div>
            <small>Immutable ceiling</small>
            <strong>{usd(run.hardCeilingMicrousd)}</strong>
          </div>
        </div>
        <p className="launchpad-note">
          You can leave this Episode. The Atrium will surface progress and notify you
          when review is needed.
        </p>
        <Link
          className="creation-primary launchpad-production-link"
          href={`/episodes/${episodeId}/production`}
        >
          Production
        </Link>
      </section>
    );
  }

  return (
    <section className="launchpad-chamber">
      <div className="launchpad-sigil" aria-hidden="true">
        <i />
        <i />
        <span>◇</span>
      </div>
      <small>The one deliberate handoff</small>
      <h1 ref={stageHeadingRef} tabIndex={-1}>
        Lock the world. Release the agentic AI crew.
      </h1>
      <p>
        This atomic action freezes the accepted cast, locations, character sheets,
        narration identity, master clock, shot graph, QC consensus and exact spending
        ceiling. If any byte changed, Monica rejects the lock instead of guessing.
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
          <small>Clock · graph · QC · quote</small>
        </div>
      </div>
      <button
        className="launch-world-lock"
        disabled={!canEdit || working || !readyToLock}
        onClick={onLock}
        type="button"
      >
        <span aria-hidden="true">✦</span>
        <strong>{working ? "Locking every dependency…" : "Confirm World Lock"}</strong>
        <small>
          {readyToLock
            ? "Atomic · irreversible · production-authorizing"
            : "Waiting for verified preflight evidence"}
        </small>
      </button>
      <p className="launchpad-note">
        This is not “start generation.” It is the exact boundary after which the
        autonomous agentic AI crew is allowed to spend and produce.
      </p>
    </section>
  );
}
