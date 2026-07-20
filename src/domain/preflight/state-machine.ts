export const preflightStates = [
  "created",
  "queued",
  "running",
  "waiting_external",
  "waiting_decision",
  "paused",
  "succeeded",
  "failed",
  "canceled",
  "superseded",
] as const;

export type PreflightState = (typeof preflightStates)[number];

export type PreflightCommand =
  | "enqueue"
  | "started"
  | "wait_external"
  | "wait_decision"
  | "pause"
  | "resume"
  | "succeed"
  | "fail"
  | "cancel"
  | "supersede";

const terminal = new Set<PreflightState>([
  "succeeded",
  "failed",
  "canceled",
  "superseded",
]);

const transitionTable: Readonly<
  Record<PreflightCommand, Readonly<Partial<Record<PreflightState, PreflightState>>>>
> = Object.freeze({
  enqueue: { created: "queued" },
  started: { queued: "running" },
  wait_external: { running: "waiting_external" },
  wait_decision: { running: "waiting_decision" },
  pause: {
    created: "paused",
    queued: "paused",
    running: "paused",
    waiting_external: "paused",
    waiting_decision: "paused",
  },
  resume: { paused: "queued" },
  succeed: { running: "succeeded", waiting_external: "succeeded" },
  fail: {
    created: "failed",
    queued: "failed",
    running: "failed",
    waiting_external: "failed",
    waiting_decision: "failed",
    paused: "failed",
  },
  cancel: {
    created: "canceled",
    queued: "canceled",
    running: "canceled",
    waiting_external: "canceled",
    waiting_decision: "canceled",
    paused: "canceled",
  },
  supersede: {
    created: "superseded",
    queued: "superseded",
    running: "superseded",
    waiting_external: "superseded",
    waiting_decision: "superseded",
    paused: "superseded",
  },
});

export class PreflightTransitionError extends Error {
  override readonly name = "PreflightTransitionError";
}

export function isTerminalPreflightState(state: PreflightState): boolean {
  return terminal.has(state);
}

export function transitionPreflight(
  state: PreflightState,
  command: PreflightCommand,
): PreflightState {
  const next = transitionTable[command][state];
  if (!next) {
    throw new PreflightTransitionError(
      `preflight.${command} is invalid from ${state}.`,
    );
  }
  return next;
}
