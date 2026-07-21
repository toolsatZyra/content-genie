"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { RefObject } from "react";

import type { CreationPreflightProjection } from "@/domain/creation-readiness";

interface CreationLaunchpadProps {
  readonly episodeId: string;
  readonly preflight: CreationPreflightProjection;
  readonly stageHeadingRef: RefObject<HTMLHeadingElement | null>;
}

function usd(microusd: number): string {
  return `$${(microusd / 1_000_000).toFixed(2)}`;
}

export function CreationLaunchpad({
  episodeId,
  preflight,
  stageHeadingRef,
}: CreationLaunchpadProps) {
  const router = useRouter();
  const run = preflight.productionRun;

  useEffect(() => {
    if (!run) return;
    router.replace(`/episodes/${episodeId}/production`);
  }, [episodeId, router, run]);

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
          Opening the live production room automatically. The Atrium will continue to
          surface progress and notify you when final review is needed.
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
      <small>Autonomous production handoff</small>
      <h1 ref={stageHeadingRef} tabIndex={-1}>
        Monica is sealing the production baton.
      </h1>
      <p>
        The agentic AI crew is freezing the accepted cast, locations, character sheets,
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
      <div className="launch-world-lock" aria-live="polite" role="status">
        <span aria-hidden="true">✦</span>
        <strong>Locking every verified dependency…</strong>
        <small>Atomic · bounded · production-authorizing</small>
      </div>
      <p className="launchpad-note">
        No click is required. When the immutable run is present, this screen opens the
        live production room. Final exact-master approval remains yours.
      </p>
    </section>
  );
}
