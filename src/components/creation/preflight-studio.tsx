"use client";

import { useState, type RefObject } from "react";

import type { CreationPreflightProjection } from "@/domain/creation-readiness";

interface PreflightStudioProps {
  readonly canEdit: boolean;
  readonly onAppointReviewer: () => void;
  readonly onConfirmQuote: () => void;
  readonly onContinue: () => void;
  readonly onSourceReview: (decision: "approve" | "block", rationale: string) => void;
  readonly projection: CreationPreflightProjection;
  readonly stageHeadingRef: RefObject<HTMLHeadingElement | null>;
  readonly working: boolean;
}

function usd(microusd: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(microusd / 1_000_000);
}

function score(value: number | undefined): string {
  return typeof value === "number" ? value.toFixed(1) : "—";
}

function expiry(isoTimestamp: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(isoTimestamp));
}

function quoteLineLabel(lineKind: string): string {
  return lineKind
    .replaceAll("_", " ")
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function terminalFailureCopy(code: string): Readonly<{
  detail: string;
  title: string;
}> {
  if (code === "plan-quality-blocked" || code === "plan-repair-no-change") {
    return {
      detail:
        "Monica used the complete allowance of two materially different repairs, but the fresh blind evaluator pair still rejected the cinematic plan. No production authority or provider spend was created. Review the World anchors before starting a new Preflight attempt.",
      title: "The cinematic plan did not clear Monica’s quality floor",
    };
  }
  if (code === "production-quote-ceiling-exceeded") {
    return {
      detail:
        "The complete quality-first provider, QC, render and repair envelope is above the $50 launch ceiling. No quote was exposed and no spend was authorized. The production route must be simplified without weakening the locked script or quality gates before retrying.",
      title: "The full quality envelope is above $50",
    };
  }
  return {
    detail:
      "An exact Preflight prerequisite failed and the attempt was sealed instead of being retried indefinitely. No production authority or provider spend was created. The work queue contains the durable recovery item.",
    title: "Preflight stopped safely",
  };
}

export function PreflightStudio({
  canEdit,
  onAppointReviewer,
  onConfirmQuote,
  onContinue,
  onSourceReview,
  projection,
  stageHeadingRef,
  working,
}: PreflightStudioProps) {
  const [reviewRationale, setReviewRationale] = useState("");
  const sourceReview = projection.sourceReview;
  const terminalFailure = projection.failure
    ? terminalFailureCopy(projection.failure.code)
    : null;
  const sourceReady = sourceReview?.status === "approved";
  const audioReady = projection.audioIdentity?.state === "verified";
  const clockReady = projection.masterClock?.state === "verified";
  const planReady = projection.plan?.state === "qc_passed";
  const qcReady = projection.qc?.verdict === "pass";
  const quoteReady = Boolean(projection.quote && !projection.quote.expired);
  const quoteConfirmed =
    projection.quote?.confirmed === true && projection.quote.expired === false;
  const quoteGroups = Object.values(
    (projection.quote?.lines ?? []).reduce<
      Record<
        string,
        {
          expected: number;
          high: number;
          kind: string;
          low: number;
          quantity: number;
        }
      >
    >((groups, line) => {
      const group = groups[line.lineKind] ?? {
        expected: 0,
        high: 0,
        kind: line.lineKind,
        low: 0,
        quantity: 0,
      };
      group.expected += line.expectedAmountMicrousd;
      group.high += line.highAmountMicrousd;
      group.low += line.lowAmountMicrousd;
      group.quantity += line.expectedQuantity;
      groups[line.lineKind] = group;
      return groups;
    }, {}),
  );
  const automatedReady =
    !terminalFailure &&
    sourceReady &&
    audioReady &&
    clockReady &&
    planReady &&
    qcReady &&
    quoteReady;
  const stages = [
    {
      detail: sourceReview
        ? `${sourceReview.status.replaceAll("_", " ")} · ${sourceReview.sources.length} evidence links`
        : "Evidence packet assembly pending",
      label: "Qualified cultural review",
      ready: sourceReady,
    },
    {
      detail: projection.audioIdentity
        ? `Voice identity ${projection.audioIdentity.state}`
        : "Persistent voice evidence pending",
      label: "Voice + pronunciation",
      ready: audioReady,
    },
    {
      detail: projection.masterClock
        ? `${(projection.masterClock.durationMs / 1_000).toFixed(1)} sec master clock`
        : "Narration timing pending",
      label: "Master clock",
      ready: clockReady,
    },
    {
      detail: projection.plan
        ? `Story graph ${projection.plan.state.replaceAll("_", " ")}`
        : "Beat and shot graph pending",
      label: "Cinematic plan",
      ready: planReady,
    },
    {
      detail: projection.qc
        ? `${projection.qc.verdict} · ${projection.qc.evidenceDensity.toFixed(1)} evidence density`
        : "Independent evaluator consensus pending",
      label: "Monica consensus",
      ready: qcReady,
    },
    {
      detail: projection.quote
        ? `${usd(projection.quote.expectedTotalMicrousd)} expected`
        : "Provider rates and repair allowance pending",
      label: "Exact production quote",
      ready: quoteReady,
    },
  ] as const;

  return (
    <section className="preflight-chamber">
      <header className="preflight-heading">
        <div>
          <span className="eyebrow">Monica’s autonomous table read</span>
          <h1 ref={stageHeadingRef} tabIndex={-1}>
            The film exists here before a frame is spent.
          </h1>
          <p>
            Specialist agents bind voice, timing, cultural evidence, shot grammar,
            reference order and provider capability into one immutable production plan.
            You make the one qualified cultural-evidence decision, then approve the
            exact spending ceiling—not Monica’s internal craft decisions.
          </p>
        </div>
        <div
          className={`monica-core${automatedReady ? " is-ready" : ""}`}
          aria-label={
            automatedReady
              ? "Monica preflight passed"
              : "Monica preflight is still assembling evidence"
          }
        >
          <i />
          <i />
          <i />
          <span>M</span>
          <small>{automatedReady ? "PASS" : "READING"}</small>
        </div>
      </header>

      {projection.failure && terminalFailure ? (
        <section className="preflight-terminal" role="alert">
          <div>
            <small>
              Sealed attempt {projection.failure.attemptNo} ·{" "}
              {projection.failure.stageKey.replaceAll("_", " ")}
            </small>
            <h2>{terminalFailure.title}</h2>
            <p>{terminalFailure.detail}</p>
          </div>
          <span>No spend</span>
        </section>
      ) : null}

      <section
        className={`source-review-panel${sourceReview?.status === "blocked" ? " is-blocked" : sourceReady ? " is-approved" : ""}`}
        aria-label="Qualified cultural review"
      >
        <header>
          <div>
            <small>Human authority · exact evidence set</small>
            <h2>Culture, theology and dignity review</h2>
          </div>
          <span>{sourceReview?.status.replaceAll("_", " ") ?? "assembling"}</span>
        </header>
        {!sourceReview ? (
          <p>
            Monica is binding the locked narration, selected deity forms, named-temple
            photography, rights evidence and non-overridable launch policy.
          </p>
        ) : (
          <>
            <div className="source-review-facts">
              <div>
                <small>Tradition</small>
                <strong>{sourceReview.tradition}</strong>
              </div>
              <div>
                <small>Region</small>
                <strong>{sourceReview.region}</strong>
              </div>
              <div>
                <small>Sources</small>
                <strong>{sourceReview.sources.length}</strong>
              </div>
              <div>
                <small>Policy checks</small>
                <strong>{sourceReview.findings.length}</strong>
              </div>
            </div>
            <div className="source-review-evidence">
              <details open>
                <summary>
                  Source evidence <span>{sourceReview.sources.length}</span>
                </summary>
                <ul>
                  {sourceReview.sources.map((source) => (
                    <li key={`${source.sourceVersionId}:${source.claimClass}`}>
                      <div>
                        <strong>{source.title}</strong>
                        <small>
                          {source.claimClass.replaceAll("_", " ")} ·{" "}
                          {source.rightsStatus.replaceAll("_", " ")}
                        </small>
                        <p>{source.boundedProposition}</p>
                      </div>
                      {source.stableUrl ? (
                        <a
                          href={source.stableUrl}
                          rel="noreferrer noopener"
                          target="_blank"
                        >
                          Inspect source ↗
                        </a>
                      ) : (
                        <span>Locked internal source</span>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
              <details>
                <summary>
                  Monica’s policy findings <span>{sourceReview.findings.length}</span>
                </summary>
                <ul>
                  {sourceReview.findings.map((finding) => (
                    <li key={finding.ruleCode}>
                      <div>
                        <strong>{finding.ruleCode}</strong>
                        <small>{finding.verdict.replaceAll("_", " ")}</small>
                        <p>{finding.safeSummary}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
            {sourceReview.status === "pending_qualified_review" ? (
              sourceReview.competencies.length === 0 ? (
                <div className="source-review-attestation">
                  <p>
                    Activate reviewer responsibility only if you are Zyra’s designated
                    launch decision maker for cultural, theological, regional, rights
                    and dignity review. A verified authenticator and workspace-admin
                    role are required.
                  </p>
                  <button
                    className="creation-secondary"
                    disabled={!canEdit || working}
                    onClick={onAppointReviewer}
                    type="button"
                  >
                    Activate reviewer responsibility
                  </button>
                </div>
              ) : (
                <div className="source-review-decision">
                  <label htmlFor="source-review-rationale">
                    Decision rationale
                    <textarea
                      id="source-review-rationale"
                      maxLength={4000}
                      onChange={(event) => setReviewRationale(event.target.value)}
                      placeholder="State what you checked, the interpretation accepted, and any bounded caveats."
                      value={reviewRationale}
                    />
                  </label>
                  <div>
                    <button
                      className="creation-secondary is-danger"
                      disabled={
                        !canEdit || working || reviewRationale.trim().length < 2
                      }
                      onClick={() => onSourceReview("block", reviewRationale)}
                      type="button"
                    >
                      Block this evidence set
                    </button>
                    <button
                      className="creation-primary"
                      disabled={
                        !canEdit || working || reviewRationale.trim().length < 2
                      }
                      onClick={() => onSourceReview("approve", reviewRationale)}
                      type="button"
                    >
                      Approve exact evidence set
                    </button>
                  </div>
                </div>
              )
            ) : (
              <p className="source-review-final">
                {sourceReady
                  ? "Approved evidence is pinned to this exact script and World. Any upstream change makes it stale."
                  : "Production remains blocked until a new exact evidence packet is reviewed."}
              </p>
            )}
          </>
        )}
      </section>

      <div className="preflight-grid">
        <ol className="preflight-timeline">
          {stages.map((stage, index) => (
            <li className={stage.ready ? "is-ready" : "is-pending"} key={stage.label}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{stage.label}</strong>
                <small>{stage.detail}</small>
              </div>
              <em>{stage.ready ? "verified" : "waiting"}</em>
            </li>
          ))}
        </ol>

        <aside className="preflight-scorecard">
          <header>
            <small>Viewer-impact forecast</small>
            <strong>{projection.qc?.verdict ?? "unscored"}</strong>
          </header>
          <div className="preflight-scores">
            <div>
              <span>OVS</span>
              <strong>
                {score(projection.qc?.ovs ?? projection.plan?.projectedOvs)}
              </strong>
              <small>Overall visual score</small>
            </div>
            <div>
              <span>CVP</span>
              <strong>
                {score(projection.qc?.cvp ?? projection.plan?.projectedCvp)}
              </strong>
              <small>Continuity viability</small>
            </div>
            <div>
              <span>PFS</span>
              <strong>
                {score(projection.qc?.pfs ?? projection.plan?.projectedPfs)}
              </strong>
              <small>Production feasibility</small>
            </div>
            <div>
              <span>Confidence</span>
              <strong>
                {score(
                  projection.qc?.confidence ?? projection.plan?.projectedConfidence,
                )}
              </strong>
              <small>Evidence confidence</small>
            </div>
          </div>
          {projection.qc?.gateCodes.length ? (
            <div
              className="preflight-gates"
              role={projection.qc.verdict === "pass" ? "status" : "alert"}
            >
              <small>Active gate codes</small>
              <p>{projection.qc.gateCodes.join(" · ")}</p>
            </div>
          ) : (
            <p className="preflight-clear">No unresolved deterministic gates.</p>
          )}
        </aside>
      </div>

      <section
        className={`production-quote${projection.quote?.target40UsdBreached ? " is-over-target" : ""}`}
        aria-label="Exact production quote"
      >
        <header>
          <div>
            <small>Quality-first production envelope</small>
            <h2>
              {projection.quote
                ? usd(projection.quote.expectedTotalMicrousd)
                : "Quote pending"}
            </h2>
          </div>
          <span>
            {projection.quote?.expired
              ? "Quote expired · Monica must reprice"
              : quoteConfirmed
                ? "You confirmed this ceiling"
                : "AAL2 confirmation required"}
          </span>
        </header>
        {projection.quote ? (
          <div className="quote-spectrum">
            <div>
              <small>Low</small>
              <strong>{usd(projection.quote.lowTotalMicrousd)}</strong>
            </div>
            <div>
              <small>Expected</small>
              <strong>{usd(projection.quote.expectedTotalMicrousd)}</strong>
            </div>
            <div>
              <small>Full high</small>
              <strong>{usd(projection.quote.highTotalMicrousd)}</strong>
            </div>
            <div>
              <small>Hard ceiling</small>
              <strong>{usd(projection.quote.hardCeilingMicrousd)}</strong>
            </div>
          </div>
        ) : (
          <p>
            Monica will expose the complete provider, render, QC and repair envelope
            before authorization.
          </p>
        )}
        {projection.quote && quoteGroups.length > 0 ? (
          <details className="quote-breakdown" open>
            <summary>
              Exact cost composition <span>{quoteGroups.length} categories</span>
            </summary>
            <div className="quote-lines" role="table" aria-label="Quote line items">
              <div className="quote-line is-heading" role="row">
                <span role="columnheader">Category</span>
                <span role="columnheader">Units</span>
                <span role="columnheader">Expected</span>
                <span role="columnheader">High</span>
              </div>
              {quoteGroups.map((group) => (
                <div className="quote-line" key={group.kind} role="row">
                  <span role="cell">{quoteLineLabel(group.kind)}</span>
                  <span role="cell">
                    {group.quantity.toFixed(2).replace(/\.00$/u, "")}
                  </span>
                  <strong role="cell">{usd(group.expected)}</strong>
                  <span role="cell">{usd(group.high)}</span>
                </div>
              ))}
            </div>
          </details>
        ) : null}
        {projection.quote?.expired ? (
          <p className="quote-warning" role="alert">
            This rate evidence is no longer current. No confirmation or World Lock can
            proceed until Monica produces a fresh exact quote.
          </p>
        ) : null}
        {projection.quote?.target40UsdBreached ? (
          <p className="quote-warning" role="alert">
            The expected quote exceeds the $40 target. Quality remains protected; the
            $50 hard ceiling still cannot be exceeded.
          </p>
        ) : null}
        <footer>
          <small>
            {projection.quote
              ? `Expires ${expiry(projection.quote.expiresAt)} UTC`
              : "No spend authority exists yet"}
          </small>
          {!quoteConfirmed ? (
            <button
              className="creation-primary"
              disabled={!canEdit || working || !automatedReady || !projection.quote}
              onClick={onConfirmQuote}
              type="button"
            >
              Confirm exact ceiling
            </button>
          ) : (
            <button
              className="creation-primary"
              disabled={working}
              onClick={onContinue}
              type="button"
            >
              Review World Lock <span aria-hidden="true">→</span>
            </button>
          )}
        </footer>
      </section>
    </section>
  );
}
