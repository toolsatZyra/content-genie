export const providerRequestStates = [
  "reserved",
  "queued",
  "submitted",
  "accepted",
  "polling",
  "succeeded",
  "failed_retryable",
  "failed_terminal",
  "cancel_requested",
  "canceled",
] as const;

export type ProviderRequestState = (typeof providerRequestStates)[number];

export type ProviderRequestEvent =
  | "enqueue"
  | "submit"
  | "accept"
  | "poll"
  | "complete"
  | "fail_retryable"
  | "fail_terminal"
  | "request_cancel"
  | "confirm_canceled";

export type LateCompletionClass =
  "duplicate" | "stale" | "billable_no_asset" | "quarantined_asset";

const transitions: Readonly<
  Record<
    ProviderRequestEvent,
    Readonly<Partial<Record<ProviderRequestState, ProviderRequestState>>>
  >
> = Object.freeze({
  enqueue: { reserved: "queued" },
  submit: { queued: "submitted" },
  accept: { submitted: "accepted" },
  poll: { accepted: "polling", polling: "polling" },
  complete: {
    submitted: "succeeded",
    accepted: "succeeded",
    polling: "succeeded",
  },
  fail_retryable: {
    submitted: "failed_retryable",
    accepted: "failed_retryable",
    polling: "failed_retryable",
  },
  fail_terminal: {
    submitted: "failed_terminal",
    accepted: "failed_terminal",
    polling: "failed_terminal",
  },
  request_cancel: {
    reserved: "cancel_requested",
    queued: "cancel_requested",
    submitted: "cancel_requested",
    accepted: "cancel_requested",
    polling: "cancel_requested",
  },
  confirm_canceled: { cancel_requested: "canceled" },
});

export class ProviderRequestTransitionError extends Error {
  override readonly name = "ProviderRequestTransitionError";
}

export function transitionProviderRequest(
  state: ProviderRequestState,
  event: ProviderRequestEvent,
): ProviderRequestState {
  const next = transitions[event][state];
  if (!next) {
    throw new ProviderRequestTransitionError(
      `provider.${event} is invalid from ${state}.`,
    );
  }
  return next;
}

export function classifyLateProviderCompletion(
  input: Readonly<{
    hasQuarantinedAsset: boolean;
    isBillable: boolean;
    isDuplicate: boolean;
  }>,
): LateCompletionClass {
  if (input.isDuplicate) return "duplicate";
  if (input.hasQuarantinedAsset) return "quarantined_asset";
  if (input.isBillable) return "billable_no_asset";
  return "stale";
}
