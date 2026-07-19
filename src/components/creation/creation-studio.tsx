"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import {
  configurationConfirmationGate,
  creationAccessForEpisode,
  lookAvailabilityCanBeSelected,
  type CreationChamber,
  type CreationProjection,
  type LookAvailabilityStatus,
} from "@/domain/creation";
import {
  retainIdempotencyAttempt,
  type RetainedIdempotencyAttempt,
} from "@/domain/idempotency";
import {
  durationNeedsAcknowledgement,
  estimateNarrationDurationSeconds,
} from "@/domain/profile/launch-profile";
import {
  emptyExactTextareaHistory,
  exactOffsetAtTextareaOffset,
  planExactTextareaBeforeInput,
  recordExactTextareaEdit,
  redoExactTextareaEdit,
  reconcileTextareaEdit,
  spliceExactTextareaText,
  textareaDisplayText,
  undoExactTextareaEdit,
} from "@/domain/script/exact-textarea";
import { MAX_BROWSER_SCRIPT_UTF8_BYTES } from "@/domain/script/limits";
import {
  DEFAULT_LOOK_ID,
  LOOKS,
  LOOK_FAMILIES,
  findLook,
  findLookByVersionId,
  searchLooks,
} from "@/domain/look/look-registry";
import {
  DEFAULT_NARRATOR_GENDER,
  VOICE_VERSIONS,
  findVoiceByVersionId,
  voiceForGender,
  type NarratorGender,
} from "@/domain/voice/voice-registry";
import {
  CommandMutationError,
  readCommandResponse,
  sendCommand,
} from "@/lib/commands/client";

const chambers: readonly {
  readonly id: CreationChamber;
  readonly label: string;
}[] = [
  { id: "script", label: "Script" },
  { id: "voice", label: "Voice" },
  { id: "look", label: "Look" },
  { id: "world", label: "World" },
  { id: "preflight", label: "Preflight" },
  { id: "create", label: "Create" },
];

interface MutationResult {
  readonly aggregateVersion?: number;
  readonly configurationVersion?: number;
  readonly episodeVersion?: number;
}

type SaveState = "idle" | "rejected" | "saved" | "saving" | "unconfirmed";
type DraftStorageState = "available" | "checking" | "unavailable";
const LOOK_PAGE_SIZE = 24;

function commandResult(value: unknown): MutationResult {
  return value && typeof value === "object" ? (value as MutationResult) : {};
}

function voiceAvailabilityCanBeSelected(
  status: "pending_authenticated_canary" | "verified" | "withdrawn" | undefined,
): boolean {
  return status === "pending_authenticated_canary" || status === "verified";
}

export function CreationStudio({
  initialChamber,
  projection,
  restoreAuthoritativeLook = false,
}: Readonly<{
  initialChamber?: CreationChamber | undefined;
  projection: CreationProjection;
  restoreAuthoritativeLook?: boolean;
}>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pinnedLook = projection.configuration
    ? findLookByVersionId(projection.configuration.lookVersionId)
    : undefined;
  const lookPinValid =
    !projection.configuration ||
    (Boolean(pinnedLook) &&
      projection.configuration.lookAvailabilityStatus === "active" &&
      lookAvailabilityCanBeSelected(
        projection.configuration.lookAvailabilityByVersionId[
          projection.configuration.lookVersionId
        ],
      ));
  const initialLookId = !projection.configuration
    ? DEFAULT_LOOK_ID
    : lookPinValid
      ? (pinnedLook?.id ?? "")
      : "";
  const initialLookFamily = pinnedLook?.family ?? "Indian Mythology & Devotion";
  const pinnedVoice = projection.configuration
    ? findVoiceByVersionId(projection.configuration.voiceVersionId)
    : undefined;
  const voicePinValid =
    !projection.configuration ||
    (Boolean(pinnedVoice) &&
      pinnedVoice?.gender === projection.configuration.narratorGender &&
      voiceAvailabilityCanBeSelected(
        projection.configuration.voiceAvailabilityByVersionId[
          projection.configuration.voiceVersionId
        ],
      ));
  const initialConfirmationGate = projection.configuration
    ? configurationConfirmationGate(projection.configuration)
    : null;
  const lookAvailabilityForVersion = (
    versionId: string,
  ): LookAvailabilityStatus | undefined => {
    if (!projection.configuration) return undefined;
    if (
      versionId === projection.configuration.lookVersionId &&
      projection.configuration.lookAvailabilityStatus !== "active"
    ) {
      return projection.configuration.lookAvailabilityStatus;
    }
    return projection.configuration.lookAvailabilityByVersionId[versionId];
  };
  const guardedInitialChamber =
    initialChamber === "look" && (!projection.configuration || !voicePinValid)
      ? "voice"
      : initialChamber;
  const stageHeadingRef = useRef<HTMLHeadingElement>(null);
  const chamberButtonRefs = useRef(new Map<CreationChamber, HTMLButtonElement>());
  const lookCardRefs = useRef(new Map<string, HTMLButtonElement>());
  const lookSearchRef = useRef<HTMLInputElement>(null);
  const scriptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const toastRef = useRef<HTMLDivElement>(null);
  const worldActionRef = useRef<HTMLButtonElement>(null);
  const mountedChamber = useRef(false);
  const focusInitialChamber = useRef(Boolean(initialChamber));
  const scriptLockIdempotencyKey = useRef<RetainedIdempotencyAttempt | null>(null);
  const exactTextHistory = useRef(emptyExactTextareaHistory());
  const historyBeforeInput = useRef<"historyRedo" | "historyUndo" | null>(null);
  const voiceIdempotencyKey = useRef<RetainedIdempotencyAttempt | null>(null);
  const lookIdempotencyKey = useRef<RetainedIdempotencyAttempt | null>(null);
  const [chamber, setChamber] = useState<CreationChamber>(
    guardedInitialChamber ?? (projection.script ? "voice" : "script"),
  );
  const [scriptLocked, setScriptLocked] = useState(Boolean(projection.script));
  const [rawText, setRawText] = useState(projection.script?.rawText ?? "");
  const rawTextRef = useRef(rawText);
  const [acknowledgedRawText, setAcknowledgedRawText] = useState<string | null>(null);
  const [sealAcknowledgedRawText, setSealAcknowledgedRawText] = useState<string | null>(
    null,
  );
  const [episodeVersion, setEpisodeVersion] = useState(
    projection.episode.aggregateVersion,
  );
  const [configurationVersion, setConfigurationVersion] = useState(
    projection.configuration?.aggregateVersion ?? 0,
  );
  const [narratorGender, setNarratorGender] = useState<NarratorGender>(
    projection.configuration?.narratorGender ?? DEFAULT_NARRATOR_GENDER,
  );
  const [selectedVoiceVersionId, setSelectedVoiceVersionId] = useState(
    projection.configuration?.voiceVersionId ?? "",
  );
  const [voicePinReconciled, setVoicePinReconciled] = useState(voicePinValid);
  const [voiceHumanConfirmed, setVoiceHumanConfirmed] = useState(
    !initialConfirmationGate?.blockers.includes("voice_human_confirmation_required"),
  );
  const [selectedLookId, setSelectedLookId] = useState(initialLookId);
  const [pendingLookId, setPendingLookId] = useState(selectedLookId);
  const [lookPinReconciled, setLookPinReconciled] = useState(lookPinValid);
  const [lookHumanConfirmed, setLookHumanConfirmed] = useState(
    !initialConfirmationGate?.blockers.includes("look_human_confirmation_required"),
  );
  const [lookQuery, setLookQuery] = useState("");
  const [family, setFamily] = useState(initialLookFamily);
  const [showAllLooks, setShowAllLooks] = useState(false);
  const [lookResultLimit, setLookResultLimit] = useState(LOOK_PAGE_SIZE);
  const [lookFilterStatus, setLookFilterStatus] = useState("");
  const [projectionRefreshAttempts, setProjectionRefreshAttempts] = useState(0);
  const [working, setWorking] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [notice, setNotice] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [draftRestored, setDraftRestored] = useState(false);
  const [draftStorageState, setDraftStorageState] =
    useState<DraftStorageState>("checking");
  const [persistedDraftText, setPersistedDraftText] = useState<string | null>(null);

  const estimate = estimateNarrationDurationSeconds(rawText);
  const durationAcknowledged = acknowledgedRawText === rawText;
  const scriptByteLength = new TextEncoder().encode(rawText).byteLength;
  const needsAcknowledgement = durationNeedsAcknowledgement(estimate);
  const sealAcknowledged = sealAcknowledgedRawText === rawText;
  const scriptDraftStorageKey = `genie:script-draft:v1:${projection.episode.workspaceId}:${projection.episode.id}`;
  const hasLocalDraft = !scriptLocked && rawText.length > 0;
  const draftPersistenceConfirmed =
    draftStorageState === "available" && persistedDraftText === rawText;
  const filteredLooks = useMemo(
    () => searchLooks(lookQuery, lookQuery.trim() || showAllLooks ? undefined : family),
    [family, lookQuery, showAllLooks],
  );
  const visibleLooks = useMemo(
    () => filteredLooks.slice(0, lookResultLimit),
    [filteredLooks, lookResultLimit],
  );
  const selectableVisibleLooks = visibleLooks.filter((look) =>
    lookAvailabilityCanBeSelected(lookAvailabilityForVersion(look.versionId)),
  );
  const currentIndex = chambers.findIndex(({ id }) => id === chamber);
  const creationAccess = creationAccessForEpisode(projection.episode.workflowState);
  const canEditCreation = creationAccess === "editable";
  const configurationReady = Boolean(projection.configuration);
  const selectedVoice = findVoiceByVersionId(selectedVoiceVersionId);
  const selectedVoiceAvailability =
    projection.configuration?.voiceAvailabilityByVersionId[selectedVoiceVersionId];
  const effectiveVoicePinReconciled =
    voicePinReconciled &&
    Boolean(selectedVoice) &&
    selectedVoice?.gender === narratorGender &&
    voiceAvailabilityCanBeSelected(selectedVoiceAvailability);
  const effectiveLookPinReconciled =
    lookPinReconciled &&
    Boolean(findLook(selectedLookId)) &&
    (selectedLookId !== pinnedLook?.id || lookPinValid);
  const worldConfigurationReady =
    configurationReady &&
    effectiveLookPinReconciled &&
    effectiveVoicePinReconciled &&
    lookHumanConfirmed &&
    voiceHumanConfirmed;
  const emptyLookResults = visibleLooks.length === 0;
  const moreLooksAvailable = visibleLooks.length < filteredLooks.length;
  const activeLookTabId = selectableVisibleLooks.some(({ id }) => id === pendingLookId)
    ? pendingLookId
    : selectableVisibleLooks[0]?.id;
  const saveStateLong =
    saveState === "saving"
      ? "Committing"
      : saveState === "rejected"
        ? "Change rejected - authoritative state refreshed"
        : saveState === "unconfirmed"
          ? "Outcome unconfirmed - reconciling"
          : saveState === "saved"
            ? "Authoritative state saved"
            : "Ready";
  const saveStateShort =
    saveState === "saving"
      ? "Saving"
      : saveState === "rejected"
        ? "Rejected"
        : saveState === "unconfirmed"
          ? "Reconciling"
          : saveState === "saved"
            ? "Saved"
            : "Ready";

  const centerLookCard = useCallback(
    (lookId: string, preservePagePosition = false, restoreFocus = false): void => {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const card = lookCardRefs.current.get(lookId);
          const vault = card?.closest<HTMLElement>(".look-vault");
          if (!card || !vault) {
            if (restoreFocus) lookSearchRef.current?.focus();
            return;
          }
          if (!preservePagePosition) {
            card.scrollIntoView({
              behavior: "auto",
              block: "center",
              inline: "nearest",
            });
          } else {
            const cardBox = card.getBoundingClientRect();
            const vaultBox = vault.getBoundingClientRect();
            vault.scrollTop +=
              cardBox.top + cardBox.height / 2 - (vaultBox.top + vaultBox.height / 2);
          }
          if (restoreFocus) card.focus({ preventScroll: true });
        }),
      );
    },
    [],
  );

  const focusWorldAction = useCallback((): void => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => worldActionRef.current?.focus()),
    );
  }, []);

  const dismissNotice = useCallback((): void => {
    setNotice("");
    requestAnimationFrame(() => stageHeadingRef.current?.focus());
  }, []);

  function refreshIntoChamber(targetChamber: CreationChamber): void {
    if (searchParams.get("resumeCreation") === targetChamber) {
      router.refresh();
      return;
    }
    const nextSearchParams = new URLSearchParams(searchParams.toString());
    nextSearchParams.set("resumeCreation", targetChamber);
    router.replace(`${pathname}?${nextSearchParams.toString()}` as Route, {
      scroll: false,
    });
  }

  useEffect(() => {
    let nextPersistedDraft: string | null = "";
    let nextStorageState: DraftStorageState = "available";
    let restoredDraft = "";
    try {
      if (projection.script || scriptLocked) {
        window.localStorage.removeItem(scriptDraftStorageKey);
      } else {
        const storedDraft = window.localStorage.getItem(scriptDraftStorageKey) ?? "";
        nextPersistedDraft = storedDraft;
        if (storedDraft && rawTextRef.current.length === 0) {
          restoredDraft = storedDraft;
        }
      }
    } catch {
      nextPersistedDraft = null;
      nextStorageState = "unavailable";
    }
    const hydrationMarker = window.setTimeout(() => {
      setPersistedDraftText(nextPersistedDraft);
      setDraftStorageState(nextStorageState);
      if (restoredDraft) {
        rawTextRef.current = restoredDraft;
        setRawText(restoredDraft);
        setDraftRestored(true);
      }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(hydrationMarker);
  }, [projection.script, scriptDraftStorageKey, scriptLocked]);

  useEffect(() => {
    if (!hydrated || scriptLocked) return;
    let nextPersistedDraft: string | null = rawText;
    let nextStorageState: DraftStorageState = "available";
    try {
      if (rawText.length > 0)
        window.localStorage.setItem(scriptDraftStorageKey, rawText);
      else window.localStorage.removeItem(scriptDraftStorageKey);
    } catch {
      nextPersistedDraft = null;
      nextStorageState = "unavailable";
    }
    const persistenceMarker = window.setTimeout(() => {
      setPersistedDraftText(nextPersistedDraft);
      setDraftStorageState(nextStorageState);
    }, 0);
    return () => window.clearTimeout(persistenceMarker);
  }, [hydrated, rawText, scriptDraftStorageKey, scriptLocked]);

  useEffect(() => {
    const protectDraft = (event: BeforeUnloadEvent): void => {
      if (!hasLocalDraft && !working && saveState !== "unconfirmed") return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectDraft);
    return () => window.removeEventListener("beforeunload", protectDraft);
  }, [hasLocalDraft, saveState, working]);

  useEffect(() => {
    chamberButtonRefs.current.get(chamber)?.scrollIntoView({
      behavior: "auto",
      block: "nearest",
      inline: "center",
    });
    if (!mountedChamber.current) {
      mountedChamber.current = true;
      if (focusInitialChamber.current) stageHeadingRef.current?.focus();
      return;
    }
    stageHeadingRef.current?.focus();
  }, [chamber]);

  useEffect(() => {
    if (!restoreAuthoritativeLook || chamber !== "look") return;
    centerLookCard(selectedLookId, true, true);
  }, [chamber, centerLookCard, restoreAuthoritativeLook, selectedLookId]);

  useEffect(() => {
    if (!notice || chamber !== "look" || !toastRef.current) return;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        const card = lookCardRefs.current.get(pendingLookId || selectedLookId);
        const toast = toastRef.current;
        if (!card || !toast) return;
        const cardBox = card.getBoundingClientRect();
        const toastBox = toast.getBoundingClientRect();
        const overlaps =
          cardBox.left < toastBox.right &&
          cardBox.right > toastBox.left &&
          cardBox.top < toastBox.bottom &&
          cardBox.bottom > toastBox.top;
        if (overlaps) card.scrollIntoView({ behavior: "auto", block: "center" });
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [chamber, notice, pendingLookId, selectedLookId]);

  useEffect(() => {
    if (!scriptLocked || configurationReady || projectionRefreshAttempts >= 3) {
      return;
    }
    const retryDelays = [1_200, 2_400, 4_800] as const;
    const timeout = window.setTimeout(() => {
      setProjectionRefreshAttempts((attempts) => attempts + 1);
      router.refresh();
    }, retryDelays[projectionRefreshAttempts]);
    return () => window.clearTimeout(timeout);
  }, [configurationReady, projectionRefreshAttempts, router, scriptLocked]);

  async function lockScript(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canEditCreation || projection.episode.workflowState !== "draft") return;
    const submittedRawText = rawText;
    const payload = {
      durationAcknowledged,
      episodeId: projection.episode.id,
      expectedEpisodeVersion: episodeVersion,
      rawText: submittedRawText,
      workspaceId: projection.episode.workspaceId,
    };
    const requestBody = JSON.stringify(payload);
    const attempt = retainIdempotencyAttempt(
      scriptLockIdempotencyKey.current,
      requestBody,
    );
    scriptLockIdempotencyKey.current = attempt;
    setWorking(true);
    setSaveState("saving");
    setNotice("");
    try {
      const response = await fetch(
        `/api/episodes/${encodeURIComponent(projection.episode.id)}/script-lock`,
        {
          body: requestBody,
          headers: {
            "content-type": "application/json",
            "x-idempotency-key": attempt.key,
          },
          method: "POST",
        },
      );
      const body = await readCommandResponse(
        response,
        "The exact script could not be locked.",
      );
      const result = commandResult(body.result);
      scriptLockIdempotencyKey.current = null;
      setEpisodeVersion(result.aggregateVersion ?? episodeVersion + 1);
      setRawText(submittedRawText);
      setScriptLocked(true);
      window.localStorage.removeItem(scriptDraftStorageKey);
      setProjectionRefreshAttempts(0);
      setNotice("Exact bytes sealed. Genie will only add sidecar intelligence.");
      setSaveState("saved");
      setChamber("voice");
      router.refresh();
    } catch (error) {
      if (error instanceof CommandMutationError && error.definitive) {
        scriptLockIdempotencyKey.current = null;
        setNotice(error.message);
        setSaveState("rejected");
      } else {
        setNotice(
          "The script-lock outcome is unconfirmed. Genie is reconciling authoritative state; retrying the unchanged script is safe.",
        );
        setSaveState("unconfirmed");
      }
      refreshIntoChamber("script");
    } finally {
      setWorking(false);
    }
  }

  function commitDraftText(nextExactText: string): void {
    if (
      !canEditCreation ||
      scriptLocked ||
      working ||
      nextExactText === rawTextRef.current
    )
      return;
    exactTextHistory.current = recordExactTextareaEdit(
      exactTextHistory.current,
      rawTextRef.current,
      nextExactText,
    );
    rawTextRef.current = nextExactText;
    setRawText(nextExactText);
  }

  function restoreExactHistory(inputType: "historyRedo" | "historyUndo"): void {
    if (!canEditCreation || scriptLocked || working) return;
    const transition =
      inputType === "historyUndo"
        ? undoExactTextareaEdit(exactTextHistory.current, rawTextRef.current)
        : redoExactTextareaEdit(exactTextHistory.current, rawTextRef.current);
    exactTextHistory.current = transition.history;
    rawTextRef.current = transition.text;
    setRawText(transition.text);
  }

  function preserveExactBeforeInput(
    input: InputEvent,
    target: HTMLTextAreaElement,
  ): void {
    const inputType = input.inputType;
    if (!canEditCreation || scriptLocked || working) {
      input.preventDefault();
      return;
    }
    if (inputType === "historyUndo" || inputType === "historyRedo") {
      input.preventDefault();
      historyBeforeInput.current = inputType;
      restoreExactHistory(inputType);
      queueMicrotask(() => {
        if (historyBeforeInput.current === inputType) {
          historyBeforeInput.current = null;
        }
      });
      return;
    }

    const plan = planExactTextareaBeforeInput({
      data: input.data,
      exactText: rawTextRef.current,
      inputType,
      isComposing: input.isComposing,
      textareaEnd: target.selectionEnd ?? target.value.length,
      textareaStart: target.selectionStart ?? target.value.length,
    });
    if (plan.kind === "native") return;
    input.preventDefault();
    if (plan.kind === "reject") return;
    commitDraftText(plan.text);
    requestAnimationFrame(() => {
      target.setSelectionRange(plan.textareaCaret, plan.textareaCaret);
    });
  }

  useEffect(() => {
    const target = scriptTextareaRef.current;
    if (!target) return;
    const handleBeforeInput = (event: InputEvent) => {
      preserveExactBeforeInput(event, target);
    };
    target.addEventListener("beforeinput", handleBeforeInput);
    return () => target.removeEventListener("beforeinput", handleBeforeInput);
  });

  function preserveExactHistoryShortcut(
    event: KeyboardEvent<HTMLTextAreaElement>,
  ): void {
    if (!event.ctrlKey && !event.metaKey) return;
    const key = event.key.toLowerCase();
    const inputType =
      key === "y" || (key === "z" && event.shiftKey)
        ? "historyRedo"
        : key === "z"
          ? "historyUndo"
          : null;
    if (!inputType) return;
    event.preventDefault();
    if (!canEditCreation || scriptLocked || working) return;
    restoreExactHistory(inputType);
  }

  function reconcileDraftChange(event: ChangeEvent<HTMLTextAreaElement>): void {
    if (!canEditCreation || scriptLocked || working) {
      event.currentTarget.value = textareaDisplayText(rawTextRef.current);
      return;
    }
    const inputType = (event.nativeEvent as InputEvent).inputType;
    if (inputType === "historyUndo" || inputType === "historyRedo") {
      if (historyBeforeInput.current === inputType) {
        historyBeforeInput.current = null;
      } else {
        restoreExactHistory(inputType);
      }
      return;
    }
    const input = event.nativeEvent as InputEvent;
    if (
      input.isComposing ||
      inputType.includes("Composition") ||
      inputType === "insertText" ||
      inputType === ""
    ) {
      commitDraftText(reconcileTextareaEdit(rawTextRef.current, event.target.value));
      return;
    }
    event.currentTarget.value = textareaDisplayText(rawTextRef.current);
  }

  function selectedExactText(target: HTMLTextAreaElement): string {
    const selectionStart = target.selectionStart ?? 0;
    const selectionEnd = target.selectionEnd ?? selectionStart;
    return rawTextRef.current.slice(
      exactOffsetAtTextareaOffset(rawTextRef.current, selectionStart),
      exactOffsetAtTextareaOffset(rawTextRef.current, selectionEnd),
    );
  }

  function preserveCopiedScript(event: ClipboardEvent<HTMLTextAreaElement>): void {
    const selected = selectedExactText(event.currentTarget);
    if (!selected) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", selected);
  }

  function preserveCutScript(event: ClipboardEvent<HTMLTextAreaElement>): void {
    if (!canEditCreation || scriptLocked || working) {
      event.preventDefault();
      return;
    }
    const target = event.currentTarget;
    const selectionStart = target.selectionStart ?? 0;
    const selectionEnd = target.selectionEnd ?? selectionStart;
    const selected = selectedExactText(target);
    if (!selected) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", selected);
    commitDraftText(
      spliceExactTextareaText(rawTextRef.current, selectionStart, selectionEnd, ""),
    );
    requestAnimationFrame(() =>
      target.setSelectionRange(selectionStart, selectionStart),
    );
  }

  function preservePastedScript(event: ClipboardEvent<HTMLTextAreaElement>): void {
    if (!canEditCreation || scriptLocked || working) {
      event.preventDefault();
      return;
    }
    const pastedText = event.clipboardData.getData("text/plain");
    event.preventDefault();
    const target = event.currentTarget;
    const selectionStart = target.selectionStart ?? target.value.length;
    const selectionEnd = target.selectionEnd ?? selectionStart;
    const nextCaret = selectionStart + textareaDisplayText(pastedText).length;
    commitDraftText(
      spliceExactTextareaText(
        rawTextRef.current,
        selectionStart,
        selectionEnd,
        pastedText,
      ),
    );
    requestAnimationFrame(() => {
      target.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function preserveDroppedScript(event: DragEvent<HTMLTextAreaElement>): void {
    if (!canEditCreation || scriptLocked || working) {
      event.preventDefault();
      return;
    }
    const droppedText = event.dataTransfer.getData("text/plain");
    if (!droppedText) return;
    event.preventDefault();
    const target = event.currentTarget;
    const selectionStart = target.selectionStart ?? target.value.length;
    const selectionEnd = target.selectionEnd ?? selectionStart;
    const nextCaret = selectionStart + textareaDisplayText(droppedText).length;
    commitDraftText(
      spliceExactTextareaText(
        rawTextRef.current,
        selectionStart,
        selectionEnd,
        droppedText,
      ),
    );
    requestAnimationFrame(() => target.setSelectionRange(nextCaret, nextCaret));
  }

  function moveLookFocus(
    event: KeyboardEvent<HTMLButtonElement>,
    lookId: string,
  ): void {
    if (working) return;
    const current = selectableVisibleLooks.findIndex(({ id }) => id === lookId);
    if (current < 0 || selectableVisibleLooks.length === 0) return;
    let next = current;
    if (event.key === "ArrowRight") {
      next = (current + 1) % selectableVisibleLooks.length;
    } else if (event.key === "ArrowLeft") {
      next =
        (current - 1 + selectableVisibleLooks.length) % selectableVisibleLooks.length;
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const vault = event.currentTarget.closest<HTMLElement>(".look-vault");
      const renderedColumns = vault
        ? window
            .getComputedStyle(vault)
            .gridTemplateColumns.split(/\s+/u)
            .filter(Boolean).length
        : 1;
      const verticalDelta = Math.max(1, renderedColumns);
      const candidate =
        event.key === "ArrowDown" ? current + verticalDelta : current - verticalDelta;
      if (candidate < 0 || candidate >= selectableVisibleLooks.length) {
        event.preventDefault();
        return;
      }
      next = candidate;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = selectableVisibleLooks.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const nextLook = selectableVisibleLooks[next];
    if (!nextLook) return;
    setPendingLookId(nextLook.id);
    requestAnimationFrame(() => lookCardRefs.current.get(nextLook.id)?.focus());
  }

  function applyLookFilter(
    nextQuery: string,
    nextFamily: string,
    nextShowAllLooks: boolean,
  ): void {
    const nextLooks = searchLooks(
      nextQuery,
      nextQuery.trim() || nextShowAllLooks ? undefined : nextFamily,
    );
    const pendingLookRemainsVisible = nextLooks
      .slice(0, LOOK_PAGE_SIZE)
      .some(({ id }) => id === pendingLookId);
    setLookQuery(nextQuery);
    setFamily(nextFamily);
    setShowAllLooks(nextShowAllLooks);
    setLookResultLimit(LOOK_PAGE_SIZE);
    if (pendingLookId && !pendingLookRemainsVisible) {
      setPendingLookId("");
      setLookFilterStatus(
        "The previous preview is hidden by these filters. Choose a visible look before saving.",
      );
    } else {
      setLookFilterStatus("");
    }
  }

  async function selectVoice(gender: NarratorGender): Promise<void> {
    if (
      !canEditCreation ||
      projection.episode.workflowState !== "world_setup" ||
      !projection.configuration
    )
      return;
    const voice = voiceForGender(gender);
    const availability =
      projection.configuration.voiceAvailabilityByVersionId[voice.versionId];
    if (!voiceAvailabilityCanBeSelected(availability)) {
      setNotice(
        availability === "withdrawn"
          ? "That narrator version has been withdrawn."
          : "That narrator has no trusted availability evidence.",
      );
      setSaveState("rejected");
      return;
    }
    if (
      voice.versionId === selectedVoiceVersionId &&
      gender === narratorGender &&
      effectiveVoicePinReconciled &&
      voiceHumanConfirmed
    ) {
      setNotice(`${gender === "male" ? "Male" : "Female"} narrator is already pinned.`);
      setSaveState("saved");
      return;
    }
    const payload = {
      configurationCandidateId: projection.configuration.id,
      episodeId: projection.episode.id,
      expectedCandidateVersion: configurationVersion,
      narratorGender: gender,
      voiceVersionId: voice.versionId,
      workspaceId: projection.episode.workspaceId,
    };
    const fingerprint = JSON.stringify({
      commandType: "episode.voice.select",
      payload,
    });
    const attempt = retainIdempotencyAttempt(voiceIdempotencyKey.current, fingerprint);
    voiceIdempotencyKey.current = attempt;
    setWorking(true);
    setSaveState("saving");
    setNotice("");
    try {
      const response = await sendCommand("episode.voice.select", payload, attempt.key);
      const result = commandResult(response.result);
      voiceIdempotencyKey.current = null;
      setNarratorGender(gender);
      setSelectedVoiceVersionId(voice.versionId);
      setVoicePinReconciled(true);
      setVoiceHumanConfirmed(true);
      setConfigurationVersion(result.configurationVersion ?? configurationVersion + 1);
      setEpisodeVersion(result.episodeVersion ?? episodeVersion + 1);
      setNotice(`${gender === "male" ? "Male" : "Female"} narrator pinned exactly.`);
      setSaveState("saved");
    } catch (error) {
      if (error instanceof CommandMutationError && error.definitive) {
        voiceIdempotencyKey.current = null;
        setVoiceHumanConfirmed(
          projection.configuration.voiceConfirmation.origin === "human_confirmed",
        );
        setNotice(error.message);
        setSaveState("rejected");
      } else {
        setNotice(
          "The narrator-selection outcome is unconfirmed. Genie is reconciling authoritative state; retrying the same selection is safe.",
        );
        setSaveState("unconfirmed");
      }
      refreshIntoChamber("voice");
    } finally {
      setWorking(false);
    }
  }

  async function commitLook(): Promise<void> {
    if (
      !canEditCreation ||
      projection.episode.workflowState !== "world_setup" ||
      !projection.configuration
    )
      return;
    const look = visibleLooks.some(({ id }) => id === pendingLookId)
      ? findLook(pendingLookId)
      : undefined;
    if (
      !look ||
      !lookAvailabilityCanBeSelected(lookAvailabilityForVersion(look.versionId))
    )
      return;
    if (
      look.id === selectedLookId &&
      effectiveLookPinReconciled &&
      lookHumanConfirmed
    ) {
      setNotice(`${look.name} is already pinned.`);
      setSaveState("saved");
      return;
    }
    const payload = {
      configurationCandidateId: projection.configuration.id,
      episodeId: projection.episode.id,
      expectedCandidateVersion: configurationVersion,
      lookVersionId: look.versionId,
      workspaceId: projection.episode.workspaceId,
    };
    const fingerprint = JSON.stringify({
      commandType: "episode.look.select",
      payload,
    });
    const attempt = retainIdempotencyAttempt(lookIdempotencyKey.current, fingerprint);
    lookIdempotencyKey.current = attempt;
    setWorking(true);
    setSaveState("saving");
    setNotice("");
    try {
      const response = await sendCommand("episode.look.select", payload, attempt.key);
      const result = commandResult(response.result);
      lookIdempotencyKey.current = null;
      setSelectedLookId(look.id);
      setPendingLookId(look.id);
      setFamily(look.family);
      setLookPinReconciled(true);
      setLookHumanConfirmed(true);
      setConfigurationVersion(result.configurationVersion ?? configurationVersion + 1);
      setEpisodeVersion(result.episodeVersion ?? episodeVersion + 1);
      setNotice(`${look.name} pinned to this Episode.`);
      setSaveState("saved");
      focusWorldAction();
    } catch (error) {
      if (error instanceof CommandMutationError && error.definitive) {
        lookIdempotencyKey.current = null;
        const authoritativeLook = findLook(selectedLookId);
        setPendingLookId(selectedLookId);
        setFamily(authoritativeLook?.family ?? family);
        setShowAllLooks(false);
        setLookQuery("");
        setLookResultLimit(LOOK_PAGE_SIZE);
        setLookFilterStatus("");
        setLookHumanConfirmed(
          projection.configuration.lookConfirmation.origin === "human_confirmed",
        );
        setNotice(error.message);
        setSaveState("rejected");
        centerLookCard(selectedLookId, false, true);
      } else {
        setNotice(
          "The look-selection outcome is unconfirmed. Genie is reconciling authoritative state; retrying the same look is safe.",
        );
        setSaveState("unconfirmed");
      }
      refreshIntoChamber("look");
    } finally {
      setWorking(false);
    }
  }

  function guardAtriumExit(event: MouseEvent<HTMLAnchorElement>): void {
    if (working || saveState === "unconfirmed") {
      event.preventDefault();
      setNotice(
        working
          ? "Wait for the current authoritative save to finish before leaving."
          : "Genie is reconciling an unconfirmed outcome. Stay here until the authoritative state returns.",
      );
      return;
    }
    if (
      hasLocalDraft &&
      !window.confirm(
        draftPersistenceConfirmed
          ? "Your exact script draft is saved on this device. Leave for the Atrium?"
          : "This exact script draft is not confirmed saved on this device. Leaving may permanently lose it. Leave for the Atrium?",
      )
    ) {
      event.preventDefault();
    }
  }

  return (
    <main aria-busy={working} className="creation-shell" id="main-content">
      <header className="creation-header">
        <Link
          className="creation-back"
          href={`/?seriesId=${encodeURIComponent(projection.episode.seriesId)}&episodeId=${encodeURIComponent(projection.episode.id)}`}
          onClick={guardAtriumExit}
        >
          <span aria-hidden="true">←</span> Atrium
        </Link>
        <div>
          <small>{projection.episode.seriesTitle}</small>
          <strong>{projection.episode.title}</strong>
        </div>
        <span aria-hidden="true" className={`creation-save-state is-${saveState}`}>
          <i aria-hidden="true" />
          <span className="save-state-long">{saveStateLong}</span>
          <span className="save-state-short">{saveStateShort}</span>
        </span>
      </header>

      {creationAccess !== "editable" ? (
        <p className="creation-access-banner" role="status">
          {creationAccess === "closed"
            ? "This Episode is closed. Its sealed setup remains available as a read-only record."
            : `This Episode is ${projection.episode.workflowState.replaceAll("_", " ")}. Its sealed setup is read-only here.`}
        </p>
      ) : null}

      <nav className="creation-rail" aria-label="Episode creation chambers">
        {chambers.map((item, index) => {
          const reachable =
            item.id === "look"
              ? configurationReady && effectiveVoicePinReconciled
              : index <= currentIndex || (scriptLocked && item.id === "voice");
          return (
            <button
              aria-current={item.id === chamber ? "step" : undefined}
              className={item.id === chamber ? "is-current" : ""}
              disabled={!reachable || working}
              key={item.id}
              onClick={() => setChamber(item.id)}
              ref={(node) => {
                if (node) chamberButtonRefs.current.set(item.id, node);
                else chamberButtonRefs.current.delete(item.id);
              }}
              type="button"
            >
              <span>{index + 1}</span>
              {item.label}
            </button>
          );
        })}
      </nav>

      <section className="creation-stage">
        <div className="creation-aura" aria-hidden="true" />
        {chamber === "script" ? (
          <form className="script-chamber" onSubmit={lockScript}>
            <header>
              <span className="eyebrow">The source of truth</span>
              <h1 ref={stageHeadingRef} tabIndex={-1}>
                {scriptLocked ? "Your script is sealed." : "Give Genie the story."}
              </h1>
              <p>
                Every space, line break, Hindi character and punctuation mark is
                preserved. Genie can annotate your script, never rewrite it.
              </p>
            </header>
            <label className="script-canvas">
              <span>Hindi background narration</span>
              <textarea
                aria-describedby="script-integrity-note"
                className={scriptLocked ? "is-visually-replaced" : undefined}
                disabled={!hydrated}
                lang="hi"
                onChange={reconcileDraftChange}
                onCopy={preserveCopiedScript}
                onCut={preserveCutScript}
                onDrop={preserveDroppedScript}
                onKeyDown={preserveExactHistoryShortcut}
                onPaste={preservePastedScript}
                placeholder="अपनी कथा यहाँ लिखें…"
                readOnly={scriptLocked || working || !canEditCreation}
                ref={scriptTextareaRef}
                required
                rows={16}
                value={rawText}
              />
              {scriptLocked ? (
                <pre
                  aria-describedby="script-integrity-note"
                  aria-label="Sealed Hindi background narration"
                  lang="hi"
                  tabIndex={0}
                >
                  {rawText}
                </pre>
              ) : null}
              <footer>
                <span>
                  {scriptByteLength} / {MAX_BROWSER_SCRIPT_UTF8_BYTES.toLocaleString()}{" "}
                  exact UTF-8 bytes
                </span>
                <span>≈ {Math.round(estimate)} sec</span>
              </footer>
            </label>
            {!scriptLocked ? (
              <p
                className="script-draft-status"
                role={draftStorageState === "unavailable" ? "alert" : "status"}
              >
                {draftStorageState === "unavailable"
                  ? "Local draft protection is unavailable. Keep this tab open or copy the exact script before leaving."
                  : hasLocalDraft
                    ? draftPersistenceConfirmed
                      ? draftRestored
                        ? "Exact draft restored and saved on this device."
                        : "Exact draft saved on this device."
                      : "Saving this exact draft on this device…"
                    : draftStorageState === "checking"
                      ? "Checking local draft protection…"
                      : "Start typing and Genie will preserve this draft on this device."}
              </p>
            ) : null}
            {scriptByteLength > MAX_BROWSER_SCRIPT_UTF8_BYTES && !scriptLocked ? (
              <p className="configuration-blocker" role="alert">
                This script is {scriptByteLength.toLocaleString()} UTF-8 bytes. The
                current exact-lock limit is{" "}
                {MAX_BROWSER_SCRIPT_UTF8_BYTES.toLocaleString()} bytes.
              </p>
            ) : null}
            <div className="integrity-ribbon" id="script-integrity-note">
              <span aria-hidden="true">◇</span>
              <div>
                <strong>Immutable means immutable</strong>
                <p>
                  After sealing, nobody—including you—can edit, unseal, or replace this
                  Episode&apos;s words. A different script requires a new Episode.
                </p>
              </div>
              {projection.script ? (
                <code>{projection.script.rawUtf8Sha256.slice(0, 12)}…</code>
              ) : null}
            </div>
            {needsAcknowledgement && !scriptLocked ? (
              <label className="duration-acknowledgement">
                <input
                  checked={durationAcknowledged}
                  disabled={working || !canEditCreation}
                  onChange={(event) => {
                    if (!canEditCreation) return;
                    setAcknowledgedRawText(
                      event.target.checked ? rawTextRef.current : null,
                    );
                  }}
                  type="checkbox"
                />
                I understand the estimated narration is outside the 60–120 second launch
                band.
              </label>
            ) : null}
            {!scriptLocked ? (
              <label className="duration-acknowledgement seal-acknowledgement">
                <input
                  checked={sealAcknowledged}
                  disabled={working || !canEditCreation || rawText.length === 0}
                  onChange={(event) => {
                    if (!canEditCreation) return;
                    setSealAcknowledgedRawText(
                      event.target.checked ? rawTextRef.current : null,
                    );
                  }}
                  type="checkbox"
                />
                I understand that sealing is permanent for this Episode; even I cannot
                edit or unseal these exact words afterward.
              </label>
            ) : null}
            <button
              className="creation-primary"
              disabled={
                working ||
                !canEditCreation ||
                scriptLocked ||
                rawText.trim().length === 0 ||
                scriptByteLength > MAX_BROWSER_SCRIPT_UTF8_BYTES ||
                !sealAcknowledged ||
                (needsAcknowledgement && !durationAcknowledged)
              }
            >
              {working ? "Sealing script..." : "Seal exact script permanently"}{" "}
              <span aria-hidden="true">→</span>
            </button>
          </form>
        ) : null}

        {chamber === "voice" ? (
          <section className="voice-chamber">
            <header>
              <span className="eyebrow">A voice with presence</span>
              <h1 ref={stageHeadingRef} tabIndex={-1}>
                Who carries the story?
              </h1>
              <p>
                Choose the persistent narrator identity. Delhi-accented, expressive
                Hindi and Sanskrit-aware performance are the target direction; the
                authenticated voice canary must pass before World Lock.
              </p>
            </header>
            <div className="voice-orbits">
              {VOICE_VERSIONS.map((voice) => (
                <button
                  aria-pressed={
                    effectiveVoicePinReconciled &&
                    selectedVoiceVersionId === voice.versionId
                  }
                  className={
                    effectiveVoicePinReconciled &&
                    selectedVoiceVersionId === voice.versionId
                      ? "voice-orbit is-selected"
                      : "voice-orbit"
                  }
                  disabled={
                    !canEditCreation ||
                    !configurationReady ||
                    working ||
                    !voiceAvailabilityCanBeSelected(
                      projection.configuration?.voiceAvailabilityByVersionId[
                        voice.versionId
                      ],
                    )
                  }
                  key={voice.id}
                  onClick={() => void selectVoice(voice.gender)}
                  type="button"
                >
                  <span className="voice-wave" aria-hidden="true">
                    {Array.from({ length: 18 }, (_, index) => (
                      <i key={index} />
                    ))}
                  </span>
                  <small>
                    {voice.gender === "male"
                      ? "Default narrator"
                      : "Alternate narrator"}
                  </small>
                  <strong>{voice.gender === "male" ? "Male" : "Female"}</strong>
                  <p>Target: expressive Hindi · Delhi · Sanskrit-aware</p>
                  <span className="voice-validation">
                    {projection.configuration?.voiceAvailabilityByVersionId[
                      voice.versionId
                    ] === "verified"
                      ? "Authenticated voice verified"
                      : projection.configuration?.voiceAvailabilityByVersionId[
                            voice.versionId
                          ] === "pending_authenticated_canary"
                        ? "Provider voice validation pending"
                        : projection.configuration?.voiceAvailabilityByVersionId[
                              voice.versionId
                            ] === "withdrawn"
                          ? "Voice withdrawn · unavailable"
                          : "Availability evidence missing · unavailable"}
                  </span>
                  <em>
                    {effectiveVoicePinReconciled &&
                    selectedVoiceVersionId === voice.versionId
                      ? voiceHumanConfirmed
                        ? "Selection confirmed"
                        : "Confirm selection"
                      : "Choose voice"}
                  </em>
                </button>
              ))}
            </div>
            {projection.configuration ? (
              <p className="profile-binding">
                Fixed performance profile{" "}
                <code>{projection.configuration.performanceProfileId}</code>
              </p>
            ) : null}
            {!configurationReady ? (
              <div className="configuration-recovery">
                <p role="status">
                  {projectionRefreshAttempts < 3
                    ? "Finishing the script seal before voice selection..."
                    : "The script is safely sealed, but this studio view has not refreshed."}
                </p>
                {projectionRefreshAttempts >= 3 ? (
                  <button
                    onClick={() => {
                      setProjectionRefreshAttempts(0);
                      router.refresh();
                    }}
                    type="button"
                  >
                    Retry saved state
                  </button>
                ) : null}
              </div>
            ) : null}
            {configurationReady && !effectiveVoicePinReconciled ? (
              <p className="configuration-blocker" role="alert">
                The stored narrator version is missing, mismatched, or withdrawn. Genie
                has not substituted another voice; choose an available exact narrator
                version before World Setup can continue.
              </p>
            ) : null}
            {configurationReady &&
            effectiveVoicePinReconciled &&
            !voiceHumanConfirmed ? (
              <p className="confirmation-required" role="status">
                The selected narrator is a system default. Confirm it explicitly before
                World Setup can progress.
              </p>
            ) : null}
            <button
              className="creation-primary"
              disabled={
                !canEditCreation ||
                !configurationReady ||
                working ||
                !effectiveVoicePinReconciled
              }
              onClick={() => setChamber("look")}
              type="button"
            >
              Enter the look vault <span aria-hidden="true">→</span>
            </button>
          </section>
        ) : null}

        {chamber === "look" ? (
          <section className="look-chamber">
            <header className="look-heading">
              <div>
                <span className="eyebrow">117 visual worlds</span>
                <h1 ref={stageHeadingRef} tabIndex={-1}>
                  Choose the film’s visual soul.
                </h1>
                <p>
                  The look becomes a deterministic second prompt block; story
                  composition always comes from the sealed script.
                </p>
              </div>
              <label>
                <span className="sr-only">Search all looks</span>
                <input
                  disabled={working}
                  onChange={(event) =>
                    applyLookFilter(event.target.value, family, showAllLooks)
                  }
                  placeholder="Search all 117 looks"
                  ref={lookSearchRef}
                  type="search"
                  value={lookQuery}
                />
              </label>
            </header>
            {!lookQuery.trim() ? (
              <div className="look-families" aria-label="Look families">
                <button
                  aria-pressed={showAllLooks}
                  disabled={working}
                  onClick={(event) => {
                    applyLookFilter("", family, true);
                    event.currentTarget.scrollIntoView({
                      behavior: "auto",
                      block: "nearest",
                      inline: "center",
                    });
                  }}
                  type="button"
                >
                  All looks
                </button>
                {LOOK_FAMILIES.map((item) => (
                  <button
                    aria-pressed={!showAllLooks && family === item}
                    disabled={working}
                    key={item}
                    onClick={(event) => {
                      applyLookFilter("", item, false);
                      event.currentTarget.scrollIntoView({
                        behavior: "auto",
                        block: "nearest",
                        inline: "center",
                      });
                    }}
                    type="button"
                  >
                    {item.replace(" & Devotion", "")}
                  </button>
                ))}
              </div>
            ) : null}
            <p className="sr-only" aria-live="polite" role="status">
              {visibleLooks.length} of {filteredLooks.length} matching looks shown.
            </p>
            {lookFilterStatus ? (
              <p className="look-filter-status" role="status">
                {lookFilterStatus}
              </p>
            ) : null}
            <p className="sr-only" id="look-vault-instructions">
              Activate a visual look to preview it. Previewing does not change the
              Episode pin. Arrow keys move between available looks; Use this look is the
              only action that commits a preview when editing is allowed.
            </p>
            <div className="look-vault-layout">
              <div
                aria-describedby="look-vault-instructions"
                aria-label="Visual looks"
                className="look-vault"
                role="group"
              >
                {visibleLooks.map((look, index) => {
                  const availability = lookAvailabilityForVersion(look.versionId);
                  const available = lookAvailabilityCanBeSelected(availability);
                  const availabilityLabel = available
                    ? "Available"
                    : availability === "withdrawn"
                      ? "Withdrawn, unavailable"
                      : availability === "unavailable"
                        ? "Availability missing, unavailable"
                        : "Availability missing, unavailable";
                  return (
                    <button
                      aria-label={`${look.name}: ${look.feel}. ${availabilityLabel}`}
                      aria-pressed={pendingLookId === look.id}
                      className={`${pendingLookId === look.id ? "look-card is-selected" : "look-card"}${available ? "" : " is-unavailable"}`}
                      disabled={working || !available}
                      key={look.id}
                      onClick={() => {
                        if (working || !available) return;
                        setPendingLookId(look.id);
                        setLookFilterStatus("");
                      }}
                      onKeyDown={(event) => moveLookFocus(event, look.id)}
                      ref={(node) => {
                        if (node) lookCardRefs.current.set(look.id, node);
                        else lookCardRefs.current.delete(look.id);
                      }}
                      tabIndex={activeLookTabId === look.id ? 0 : -1}
                      type="button"
                    >
                      {/* Static, content-addressed audited assets; no remote image loader. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        alt=""
                        loading={index < 8 ? "eager" : "lazy"}
                        src={look.preview.path}
                      />
                      <span>
                        <strong>{look.name}</strong>
                        <small>{look.feel}</small>
                      </span>
                      {!available ? (
                        <em>
                          {availability === "withdrawn" ? "Withdrawn" : "Unavailable"}
                        </em>
                      ) : look.id === DEFAULT_LOOK_ID ? (
                        <em>Genie default</em>
                      ) : null}
                    </button>
                  );
                })}
                {emptyLookResults ? (
                  <p className="look-empty">
                    No visual worlds match “{lookQuery.trim()}”. Try a broader search.
                  </p>
                ) : null}
              </div>
              {moreLooksAvailable ? (
                <button
                  className="look-show-more"
                  disabled={working}
                  onClick={() =>
                    setLookResultLimit((current) => current + LOOK_PAGE_SIZE)
                  }
                  type="button"
                >
                  Show{" "}
                  {Math.min(LOOK_PAGE_SIZE, filteredLooks.length - visibleLooks.length)}{" "}
                  more looks
                </button>
              ) : null}
              <footer className="look-commit-bar">
                <div>
                  <small>
                    {canEditCreation ? "Previewing—not pinned" : "Inspecting"}
                  </small>
                  <strong>
                    {emptyLookResults
                      ? "No matching look"
                      : (findLook(pendingLookId)?.name ?? "Choose a visible look")}
                  </strong>
                  <span>
                    {visibleLooks.length} shown · {filteredLooks.length} matching ·{" "}
                    {LOOKS.length} total
                  </span>
                </div>
                <button
                  className="creation-primary"
                  disabled={
                    !configurationReady ||
                    !canEditCreation ||
                    working ||
                    emptyLookResults ||
                    !visibleLooks.some(({ id }) => id === pendingLookId) ||
                    !findLook(pendingLookId) ||
                    !lookAvailabilityCanBeSelected(
                      lookAvailabilityForVersion(
                        findLook(pendingLookId)?.versionId ?? "",
                      ),
                    ) ||
                    (pendingLookId === selectedLookId &&
                      effectiveLookPinReconciled &&
                      lookHumanConfirmed)
                  }
                  onClick={() => void commitLook()}
                  type="button"
                >
                  {working
                    ? "Saving look..."
                    : pendingLookId === selectedLookId &&
                        effectiveLookPinReconciled &&
                        lookHumanConfirmed
                      ? "Look confirmed"
                      : "Use this look"}
                </button>
                <button
                  className="creation-secondary"
                  disabled={
                    working ||
                    !worldConfigurationReady ||
                    emptyLookResults ||
                    pendingLookId !== selectedLookId
                  }
                  onClick={() => setChamber("world")}
                  ref={worldActionRef}
                  type="button"
                >
                  Build the world →
                </button>
              </footer>
            </div>
            {!effectiveLookPinReconciled ? (
              <p className="configuration-blocker" role="alert">
                The stored look version is missing, withdrawn, or unavailable. Genie has
                not substituted another look; choose and save an available exact look
                before World Setup can continue.
              </p>
            ) : null}
            {effectiveLookPinReconciled && !lookHumanConfirmed ? (
              <p className="confirmation-required" role="status">
                This look is a system default. Use this look to confirm it explicitly
                before building the world.
              </p>
            ) : null}
          </section>
        ) : null}

        {chamber === "world" ? (
          <section className="future-chamber">
            <span aria-hidden="true">✦</span>
            <small>Next autonomous foundation</small>
            <h1 ref={stageHeadingRef} tabIndex={-1}>
              Characters and locations become a reusable world.
            </h1>
            <p>
              Candidate generation, prompt editing, upload quarantine, acceptance,
              version history and automatic character sheets land in the next Phase 2
              work package. No provider call is enabled yet.
            </p>
            <button disabled type="button">
              World engine safely gated
            </button>
          </section>
        ) : null}

        {chamber === "preflight" ? (
          <section className="future-chamber">
            <span aria-hidden="true">◉</span>
            <small>Automated readiness surface</small>
            <h1 ref={stageHeadingRef} tabIndex={-1}>
              Preflight is not another creative approval gate.
            </h1>
            <p>
              Monica’s specialists will validate culture, pronunciation, references,
              master-clock timing, provider feasibility and the exact quote. You only
              intervene when evidence is missing or the final World Lock needs your
              authorization.
            </p>
          </section>
        ) : null}

        {chamber === "create" ? (
          <section className="future-chamber">
            <span aria-hidden="true">◇</span>
            <small>Autonomous production</small>
            <h1 ref={stageHeadingRef} tabIndex={-1}>
              One World Lock, then the crew takes over.
            </h1>
            <p>
              Production video dispatch remains structurally disabled in this slice. It
              will unlock only after secure media, provider, quote and World Lock
              adversarial gates pass.
            </p>
          </section>
        ) : null}
      </section>

      {notice ? (
        <div
          className={`creation-toast${chamber === "look" ? " is-above-look-tray" : ""}`}
          ref={toastRef}
          role={saveState === "rejected" ? "alert" : "status"}
        >
          <span aria-hidden="true">✦</span>
          <span>{notice}</span>
          <button
            aria-label="Dismiss status message"
            onClick={dismissNotice}
            type="button"
          >
            ×
          </button>
        </div>
      ) : null}
    </main>
  );
}
