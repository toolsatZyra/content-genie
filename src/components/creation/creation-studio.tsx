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
import {
  MAX_BROWSER_SCRIPT_UTF8_BYTES,
  MAX_UPLOADED_SCRIPT_SOURCE_BYTES,
} from "@/domain/script/limits";
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
import { CreationLaunchpad } from "@/components/creation/creation-launchpad";
import { PreflightStudio } from "@/components/creation/preflight-studio";
import {
  WorldStudio,
  worldEntityKey,
  type WorldEntity,
} from "@/components/creation/world-studio";
import { shouldReconcileRealtimeStatus } from "@/lib/realtime/reconciliation";
import { getBrowserSupabaseClient } from "@/lib/supabase/browser";

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

interface PendingUploadedScript {
  readonly fileName: string;
  readonly originalBytesBase64: string;
  readonly sourceByteLength: number;
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

function decodeUploadedScriptPreview(bytes: Uint8Array): string {
  if (bytes.byteLength === 0) throw new Error("The selected script file is empty.");
  if (bytes.byteLength > MAX_UPLOADED_SCRIPT_SOURCE_BYTES) {
    throw new Error(
      `The selected file exceeds ${MAX_UPLOADED_SCRIPT_SOURCE_BYTES.toLocaleString()} source bytes.`,
    );
  }
  let encoding: "utf-16be" | "utf-16le" | "utf-8" = "utf-8";
  let offset = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    offset = 3;
  } else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = "utf-16le";
    offset = 2;
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = "utf-16be";
    offset = 2;
  }
  if (encoding !== "utf-8" && (bytes.byteLength - offset) % 2 !== 0) {
    throw new Error(
      `The selected file is not well-formed ${encoding.toUpperCase()} text.`,
    );
  }
  try {
    return new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(
      bytes.subarray(offset),
    );
  } catch {
    throw new Error(
      `The selected file is not well-formed ${encoding.toUpperCase()} text.`,
    );
  }
}

function uploadedBytesBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary);
}

function agentActivityFor(
  chamber: CreationChamber,
  projection: CreationProjection,
): Readonly<{ action: string; name: string; sequence: string }> {
  if (chamber === "script") {
    return {
      action: projection.script
        ? "Preserving the exact source and its immutable sidecars"
        : "Waiting to read and seal the exact narration",
      name: "Script Analyst",
      sequence: "Agent 1 of 15",
    };
  }
  if (chamber === "voice") {
    return {
      action: "Binding narrator identity, Hindi delivery and pronunciation",
      name: "Voice + Pronunciation Directors",
      sequence: "Agents 3–4 of 15",
    };
  }
  if (chamber === "look") {
    return {
      action: "Pinning the selected visual physics without changing the script",
      name: "Look Analyst",
      sequence: "Agent 5 of 15",
    };
  }
  if (chamber === "world") {
    const progress = projection.world.progress.filter(
      (item) => item.itemKind !== "system" || item.state === "extracting",
    );
    const current =
      progress.find((item) => item.state === "secure_ingest") ??
      progress.find((item) => item.state === "generating") ??
      progress.find((item) => item.state === "dispatched") ??
      progress.find((item) => item.state === "prompted") ??
      progress.find((item) => item.state === "researching") ??
      progress.find((item) => item.state === "extracting") ??
      progress.find((item) => item.state === "identified") ??
      progress.find((item) => item.state === "failed");
    if (current?.state === "researching") {
      return {
        action: `Researching factual visual references for ${current.displayName}`,
        name: "Source Keeper",
        sequence: "World sequence · research",
      };
    }
    if (current?.state === "prompted") {
      return {
        action: `Binding the exact look and identity prompt for ${current.displayName}`,
        name: "Prompt Engine",
        sequence: "World sequence · prompt",
      };
    }
    if (current?.state === "dispatched") {
      return {
        action: `Image request sent for ${current.displayName}; awaiting Nano Banana`,
        name: "Image Generation Worker",
        sequence: "World sequence · provider queue",
      };
    }
    if (current?.state === "generating") {
      return {
        action: `Nano Banana is generating ${current.displayName}`,
        name: "Image Generation Worker",
        sequence: "World sequence · generation",
      };
    }
    if (current?.state === "secure_ingest") {
      return {
        action: `Scanning and safely ingesting ${current.displayName}`,
        name: "Secure Media Worker",
        sequence: "World sequence · secure ingest",
      };
    }
    if (current?.state === "failed") {
      return {
        action: "Reconciling a safely stopped World task",
        name: "Monica · Quality Director",
        sequence: "World sequence · recovery",
      };
    }
    if (
      projection.world.referencePack?.state === "verified" &&
      projection.world.characters.length + projection.world.locations.length > 0
    ) {
      return {
        action: "Holding the versioned World for your final anchor decisions",
        name: "Monica · Quality Director",
        sequence: "World sequence · review",
      };
    }
    return {
      action: "Detecting characters, locations and story-significant props",
      name: "Casting Director",
      sequence: "World sequence · casting",
    };
  }
  if (chamber === "preflight") {
    if (!projection.preflight.sourceReview) {
      return {
        action: "Binding public sources, cultural claims and rights evidence",
        name: "Source Keeper + Cultural Guardian",
        sequence: "Preflight agent sequence",
      };
    }
    if (!projection.preflight.plan) {
      return {
        action: "Designing the beat, shot and edit plan against the exact audio",
        name: "Story + Shot Directors",
        sequence: "Preflight agent sequence",
      };
    }
    return {
      action: "Evaluating cinematic readiness and the bounded production plan",
      name: "Monica + QC Jury",
      sequence: "Preflight agent sequence",
    };
  }
  return {
    action: "Preparing the autonomous production baton and final human review path",
    name: "Monica · Quality Director",
    sequence: "15 specialist agents coordinated",
  };
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
  const worldBuildIdempotencyKey = useRef<RetainedIdempotencyAttempt | null>(null);
  const worldIdempotencyKeys = useRef(new Map<string, RetainedIdempotencyAttempt>());
  const worldUploadIdempotencyKeys = useRef(
    new Map<string, RetainedIdempotencyAttempt>(),
  );
  const sourceAppointmentIdempotencyKey = useRef<RetainedIdempotencyAttempt | null>(
    null,
  );
  const sourceDecisionIdempotencyKey = useRef<RetainedIdempotencyAttempt | null>(null);
  const quoteIdempotencyKey = useRef<RetainedIdempotencyAttempt | null>(null);
  const worldLockIdempotencyKey = useRef<RetainedIdempotencyAttempt | null>(null);
  const [chamber, setChamber] = useState<CreationChamber>(
    guardedInitialChamber ?? (projection.script ? "voice" : "script"),
  );
  const [scriptLocked, setScriptLocked] = useState(Boolean(projection.script));
  const [rawText, setRawText] = useState(projection.script?.rawText ?? "");
  const rawTextRef = useRef(rawText);
  const [uploadedScript, setUploadedScript] = useState<PendingUploadedScript | null>(
    null,
  );
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
  const [worldOperations, setWorldOperations] = useState<
    Readonly<Record<string, "accept" | "regenerate" | "upload">>
  >({});
  const [optimisticAcceptedWorldKeys, setOptimisticAcceptedWorldKeys] = useState<
    ReadonlySet<string>
  >(new Set());
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
  const agentActivity = agentActivityFor(chamber, projection);
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
  const worldEntities = [...projection.world.characters, ...projection.world.locations];
  const activeWorldProgress = projection.world.progress.some((item) =>
    item.itemKind === "system"
      ? item.state === "extracting"
      : [
          "extracting",
          "identified",
          "researching",
          "prompted",
          "dispatched",
          "generating",
          "secure_ingest",
        ].includes(item.state),
  );
  const worldReady =
    worldEntities.length > 0 &&
    worldEntities.every(({ state }) => state === "accepted") &&
    projection.world.referencePack?.state === "verified";
  const preflightReady =
    projection.preflight.failure === null &&
    projection.preflight.sourceReview?.status === "approved" &&
    projection.preflight.audioIdentity?.state === "verified" &&
    projection.preflight.masterClock?.state === "verified" &&
    projection.preflight.plan?.state === "qc_passed" &&
    projection.preflight.qc?.verdict === "pass" &&
    projection.preflight.quote?.expired === false;
  const quoteConfirmed =
    projection.preflight.quote?.confirmed === true &&
    projection.preflight.quote.expired === false;
  const asyncCreationPending =
    !projection.preflight.productionRun &&
    projection.preflight.failure === null &&
    (activeWorldProgress ||
      worldEntities.length === 0 ||
      worldEntities.some(({ state }) => state === "generating") ||
      (worldReady && !preflightReady));
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
    if (!notice || saveState === "rejected" || saveState === "unconfirmed") return;
    const timeout = window.setTimeout(() => setNotice(""), 1_000);
    return () => window.clearTimeout(timeout);
  }, [notice, saveState]);

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

  useEffect(() => {
    if (
      !asyncCreationPending ||
      working ||
      !["world", "preflight", "create"].includes(chamber)
    ) {
      return;
    }
    const reconcile = (): void => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timeout = window.setTimeout(
      reconcile,
      activeWorldProgress ? 2_000 : worldReady ? 4_000 : 6_000,
    );
    const onVisible = (): void => {
      if (document.visibilityState === "visible") reconcile();
    };
    window.addEventListener("online", reconcile);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("online", reconcile);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [activeWorldProgress, asyncCreationPending, chamber, router, working, worldReady]);

  useEffect(() => {
    const configurationId = projection.configuration?.id;
    if (!configurationId) return;
    const supabase = getBrowserSupabaseClient();
    const channel = supabase
      .channel(`world-progress:${configurationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          filter: `configuration_candidate_id=eq.${configurationId}`,
          schema: "public",
          table: "world_build_progress_items",
        },
        () => router.refresh(),
      )
      .subscribe((status) => {
        if (shouldReconcileRealtimeStatus(status)) router.refresh();
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [projection.configuration?.id, router]);

  async function lockScript(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canEditCreation || projection.episode.workflowState !== "draft") return;
    const submittedRawText = rawText;
    const payload = uploadedScript
      ? {
          durationAcknowledged,
          episodeId: projection.episode.id,
          expectedEpisodeVersion: episodeVersion,
          originalBytesBase64: uploadedScript.originalBytesBase64,
          sourceKind: "uploaded_text" as const,
          workspaceId: projection.episode.workspaceId,
        }
      : {
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

  async function loadUploadedScript(
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file || !canEditCreation || scriptLocked || working) return;
    setNotice("");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const decodedText = decodeUploadedScriptPreview(bytes);
      commitDraftText(decodedText);
      setUploadedScript({
        fileName: file.name,
        originalBytesBase64: uploadedBytesBase64(bytes),
        sourceByteLength: bytes.byteLength,
      });
      setAcknowledgedRawText(null);
      setSealAcknowledgedRawText(null);
      setNotice(
        "Original file bytes loaded and retained. Any text edit switches this draft back to browser text.",
      );
    } catch (error) {
      setUploadedScript(null);
      setSaveState("rejected");
      setNotice(
        error instanceof Error
          ? error.message
          : "The selected script file could not be decoded safely.",
      );
      setSaveState("rejected");
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
    setUploadedScript(null);
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
    setUploadedScript(null);
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

  async function beginWorldBuild(): Promise<void> {
    if (
      !canEditCreation ||
      !projection.configuration ||
      !worldConfigurationReady ||
      working
    ) {
      return;
    }
    if (worldEntities.length > 0) {
      setChamber("world");
      return;
    }
    const payload = {
      configurationCandidateId: projection.configuration.id,
      episodeId: projection.episode.id,
      workspaceId: projection.episode.workspaceId,
    };
    const requestBody = JSON.stringify(payload);
    const attempt = retainIdempotencyAttempt(
      worldBuildIdempotencyKey.current,
      requestBody,
    );
    worldBuildIdempotencyKey.current = attempt;
    setChamber("world");
    setWorking(true);
    setSaveState("saving");
    setNotice("Monica is reading the sealed script and casting its visual world.");
    try {
      const response = await fetch(
        `/api/episodes/${encodeURIComponent(projection.episode.id)}/world-build`,
        {
          body: requestBody,
          cache: "no-store",
          headers: {
            "content-type": "application/json",
            "x-idempotency-key": attempt.key,
          },
          method: "POST",
        },
      );
      await readCommandResponse(response, "The world build could not be dispatched.");
      worldBuildIdempotencyKey.current = null;
      setSaveState("saved");
      setNotice(
        "Monica is extracting identities and locations. You can leave this Episode while the agentic AI crew works.",
      );
      refreshIntoChamber("world");
    } catch (error) {
      if (error instanceof CommandMutationError && error.definitive) {
        worldBuildIdempotencyKey.current = null;
        setSaveState("rejected");
        setNotice(error.message);
      } else {
        setSaveState("unconfirmed");
        setNotice(
          "The world-build dispatch is unconfirmed. Monica will reconcile it; retrying the unchanged request is safe.",
        );
      }
      refreshIntoChamber("world");
    } finally {
      setWorking(false);
    }
  }

  async function decideWorldCandidate(
    entity: WorldEntity,
    decision: "accept" | "regenerate",
    revisedPromptText: string | null,
  ): Promise<void> {
    const operationKey = worldEntityKey(entity);
    if (
      !canEditCreation ||
      !projection.configuration ||
      worldOperations[operationKey] !== undefined
    )
      return;
    const decisionEntityId =
      entity.entityKind === "character" ? entity.item.formId : entity.item.entityId;
    const payload = {
      candidateVersionId: entity.item.candidateVersionId,
      configurationCandidateId: projection.configuration.id,
      decision,
      entityId: decisionEntityId,
      entityKind: entity.entityKind,
      episodeId: projection.episode.id,
      expectedSelectionVersion: entity.item.aggregateVersion,
      revisedPromptText,
      workspaceId: projection.episode.workspaceId,
    };
    const fingerprint = JSON.stringify(payload);
    const attemptKey = `${entity.entityKind}:${decisionEntityId}`;
    const attempt = retainIdempotencyAttempt(
      worldIdempotencyKeys.current.get(attemptKey) ?? null,
      fingerprint,
    );
    worldIdempotencyKeys.current.set(attemptKey, attempt);
    if (decision === "regenerate") {
      setOptimisticAcceptedWorldKeys((current) => {
        const next = new Set(current);
        next.delete(operationKey);
        return next;
      });
    }
    setWorldOperations((current) => ({ ...current, [operationKey]: decision }));
    setSaveState("saving");
    setNotice("");
    try {
      const response = await fetch(
        `/api/episodes/${encodeURIComponent(projection.episode.id)}/world-decision`,
        {
          body: fingerprint,
          cache: "no-store",
          headers: {
            "content-type": "application/json",
            "x-idempotency-key": attempt.key,
          },
          method: "POST",
        },
      );
      await readCommandResponse(
        response,
        decision === "accept"
          ? "The world anchor could not be accepted."
          : "The replacement could not be requested.",
      );
      worldIdempotencyKeys.current.delete(attemptKey);
      setSaveState("saved");
      setNotice(
        decision === "accept"
          ? `${entity.item.name} is now a versioned world anchor.`
          : `Monica is recasting ${entity.item.name} from your revised composition.`,
      );
      if (decision === "accept") {
        setOptimisticAcceptedWorldKeys((current) => new Set(current).add(operationKey));
      }
      router.refresh();
    } catch (error) {
      if (error instanceof CommandMutationError && error.definitive) {
        worldIdempotencyKeys.current.delete(attemptKey);
        setSaveState("rejected");
        setNotice(error.message);
      } else {
        setSaveState("unconfirmed");
        setNotice(
          "The world-decision outcome is unconfirmed. Monica is reconciling the authoritative version; retrying the unchanged decision is safe.",
        );
      }
      router.refresh();
    } finally {
      setWorldOperations((current) => {
        const next = { ...current };
        delete next[operationKey];
        return next;
      });
    }
  }

  async function uploadWorldCandidate(entity: WorldEntity, file: File): Promise<void> {
    const supported = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
    if (!supported || file.size <= 0 || file.size > 25 * 1024 * 1024) {
      setSaveState("rejected");
      setNotice(
        "Choose a JPEG, PNG or WebP image no larger than 25 MB. Nothing was uploaded.",
      );
      return;
    }
    const operationKey = worldEntityKey(entity);
    if (
      !canEditCreation ||
      !projection.configuration ||
      worldOperations[operationKey] !== undefined
    )
      return;
    const entityId =
      entity.entityKind === "character" ? entity.item.formId : entity.item.entityId;
    const attemptKey = `${entity.entityKind}:${entityId}`;
    const fingerprint = JSON.stringify({
      candidateVersionId: entity.item.candidateVersionId,
      entityId,
      fileLastModified: file.lastModified,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      selectionVersion: entity.item.aggregateVersion,
    });
    const attempt = retainIdempotencyAttempt(
      worldUploadIdempotencyKeys.current.get(attemptKey) ?? null,
      fingerprint,
    );
    worldUploadIdempotencyKeys.current.set(attemptKey, attempt);
    setOptimisticAcceptedWorldKeys((current) => {
      const next = new Set(current);
      next.delete(operationKey);
      return next;
    });
    let encodedFilename: string;
    try {
      encodedFilename = encodeURIComponent(file.name);
    } catch {
      worldUploadIdempotencyKeys.current.delete(attemptKey);
      setSaveState("rejected");
      setNotice("That filename cannot be represented safely. Rename it and try again.");
      return;
    }
    setWorldOperations((current) => ({ ...current, [operationKey]: "upload" }));
    setSaveState("saving");
    setNotice(`Monica is inspecting ${file.name} in an isolated media chamber.`);
    try {
      const response = await fetch(
        `/api/episodes/${encodeURIComponent(projection.episode.id)}/world-upload`,
        {
          body: file,
          cache: "no-store",
          headers: {
            "content-type": file.type,
            "x-genie-candidate-version-id": entity.item.candidateVersionId,
            "x-genie-configuration-id": projection.configuration.id,
            "x-genie-entity-id": entityId,
            "x-genie-entity-kind": entity.entityKind,
            "x-genie-selection-version": String(entity.item.aggregateVersion),
            "x-genie-upload-name": encodedFilename,
            "x-genie-workspace-id": projection.episode.workspaceId,
            "x-idempotency-key": attempt.key,
          },
          method: "POST",
        },
      );
      await readCommandResponse(
        response,
        "The replacement image could not pass secure intake.",
      );
      worldUploadIdempotencyKeys.current.delete(attemptKey);
      setSaveState("saved");
      setNotice(
        `${entity.item.name} passed isolated inspection and is ready for your review.`,
      );
      refreshIntoChamber("world");
    } catch (error) {
      if (error instanceof CommandMutationError && error.definitive) {
        worldUploadIdempotencyKeys.current.delete(attemptKey);
        setSaveState("rejected");
        setNotice(error.message);
      } else {
        setSaveState("unconfirmed");
        setNotice(
          "The secure-upload outcome is unconfirmed. Keep this page open or refresh; Monica will reconcile the immutable intake before retrying.",
        );
      }
      refreshIntoChamber("world");
    } finally {
      setWorldOperations((current) => {
        const next = { ...current };
        delete next[operationKey];
        return next;
      });
    }
  }

  async function appointCulturalReviewer(): Promise<void> {
    const sourceReview = projection.preflight.sourceReview;
    if (
      !canEditCreation ||
      !sourceReview ||
      sourceReview.competencies.length > 0 ||
      working
    ) {
      return;
    }
    const payload = {
      episodeId: projection.episode.id,
      packetId: sourceReview.packetId,
      workspaceId: projection.episode.workspaceId,
    };
    const requestBody = JSON.stringify(payload);
    const attempt = retainIdempotencyAttempt(
      sourceAppointmentIdempotencyKey.current,
      requestBody,
    );
    sourceAppointmentIdempotencyKey.current = attempt;
    setWorking(true);
    setSaveState("saving");
    setNotice("");
    try {
      const response = await fetch(
        `/api/episodes/${encodeURIComponent(projection.episode.id)}/source-review/appointment`,
        {
          body: requestBody,
          cache: "no-store",
          headers: {
            "content-type": "application/json",
            "x-idempotency-key": attempt.key,
          },
          method: "POST",
        },
      );
      await readCommandResponse(
        response,
        "The cultural-review appointment could not be activated.",
      );
      sourceAppointmentIdempotencyKey.current = null;
      setSaveState("saved");
      setNotice(
        "Reviewer responsibility activated. Inspect the exact evidence before deciding.",
      );
      refreshIntoChamber("preflight");
    } catch (error) {
      if (error instanceof CommandMutationError && error.definitive) {
        sourceAppointmentIdempotencyKey.current = null;
        setSaveState("rejected");
        setNotice(error.message);
      } else {
        setSaveState("unconfirmed");
        setNotice(
          "The appointment outcome is unconfirmed. Refresh before submitting a cultural decision.",
        );
      }
      refreshIntoChamber("preflight");
    } finally {
      setWorking(false);
    }
  }

  async function decideSourceReview(
    decision: "approve" | "block",
    rationale: string,
  ): Promise<void> {
    const sourceReview = projection.preflight.sourceReview;
    const competency = sourceReview?.competencies[0];
    if (
      !canEditCreation ||
      !sourceReview ||
      !competency ||
      sourceReview.status !== "pending_qualified_review" ||
      rationale.trim().length < 2 ||
      working
    ) {
      return;
    }
    const payload = {
      competencyScopeHash: competency.scopeHash,
      competencyVersionId: competency.competencyVersionId,
      decision,
      episodeId: projection.episode.id,
      expectedStatusVersion: sourceReview.statusVersion,
      packetId: sourceReview.packetId,
      rationale: rationale.trim(),
      workspaceId: projection.episode.workspaceId,
    };
    const requestBody = JSON.stringify(payload);
    const attempt = retainIdempotencyAttempt(
      sourceDecisionIdempotencyKey.current,
      requestBody,
    );
    sourceDecisionIdempotencyKey.current = attempt;
    setWorking(true);
    setSaveState("saving");
    setNotice("");
    try {
      const response = await fetch(
        `/api/episodes/${encodeURIComponent(projection.episode.id)}/source-review/decision`,
        {
          body: requestBody,
          cache: "no-store",
          headers: {
            "content-type": "application/json",
            "x-idempotency-key": attempt.key,
          },
          method: "POST",
        },
      );
      await readCommandResponse(
        response,
        "The qualified cultural decision could not be recorded.",
      );
      sourceDecisionIdempotencyKey.current = null;
      setSaveState("saved");
      setNotice(
        decision === "approve"
          ? "Exact cultural evidence approved. Monica can continue autonomous preflight."
          : "Cultural evidence blocked. Monica will not authorize production.",
      );
      refreshIntoChamber("preflight");
    } catch (error) {
      if (error instanceof CommandMutationError && error.definitive) {
        sourceDecisionIdempotencyKey.current = null;
        setSaveState("rejected");
        setNotice(error.message);
      } else {
        setSaveState("unconfirmed");
        setNotice(
          "The cultural-review outcome is unconfirmed. Monica will reconcile it before continuing.",
        );
      }
      refreshIntoChamber("preflight");
    } finally {
      setWorking(false);
    }
  }
  async function confirmProductionQuote(): Promise<void> {
    const quote = projection.preflight.quote;
    if (
      !canEditCreation ||
      !quote ||
      quote.confirmed ||
      quote.expired ||
      !preflightReady ||
      working
    )
      return;
    const payload = {
      episodeId: projection.episode.id,
      hardCeilingMicrousd: quote.hardCeilingMicrousd,
      quoteHash: quote.quoteHash,
      quoteId: quote.id,
      workspaceId: projection.episode.workspaceId,
    };
    const requestBody = JSON.stringify(payload);
    const attempt = retainIdempotencyAttempt(quoteIdempotencyKey.current, requestBody);
    quoteIdempotencyKey.current = attempt;
    setWorking(true);
    setSaveState("saving");
    setNotice("");
    try {
      const response = await fetch(
        `/api/episodes/${encodeURIComponent(projection.episode.id)}/quote-confirm`,
        {
          body: requestBody,
          cache: "no-store",
          headers: {
            "content-type": "application/json",
            "x-idempotency-key": attempt.key,
          },
          method: "POST",
        },
      );
      await readCommandResponse(response, "The exact ceiling could not be confirmed.");
      quoteIdempotencyKey.current = null;
      setSaveState("saved");
      setNotice("Exact production ceiling confirmed. No agent may spend beyond it.");
      refreshIntoChamber("preflight");
    } catch (error) {
      if (error instanceof CommandMutationError && error.definitive) {
        quoteIdempotencyKey.current = null;
        setSaveState("rejected");
        setNotice(error.message);
      } else {
        setSaveState("unconfirmed");
        setNotice(
          "The ceiling-confirmation outcome is unconfirmed. Monica is reconciling it before any production authority exists.",
        );
      }
      refreshIntoChamber("preflight");
    } finally {
      setWorking(false);
    }
  }

  async function lockWorld(): Promise<void> {
    const quote = projection.preflight.quote;
    if (
      !canEditCreation ||
      !projection.configuration ||
      !worldReady ||
      !preflightReady ||
      !quote?.confirmed ||
      quote.expired ||
      working
    )
      return;
    const payload = {
      configurationCandidateId: projection.configuration.id,
      episodeId: projection.episode.id,
      expectedConfigurationVersion: Math.max(
        configurationVersion,
        projection.configuration.aggregateVersion,
      ),
      expectedEpisodeVersion: Math.max(
        episodeVersion,
        projection.episode.aggregateVersion,
      ),
      quoteId: quote.id,
      workspaceId: projection.episode.workspaceId,
    };
    const requestBody = JSON.stringify(payload);
    const attempt = retainIdempotencyAttempt(
      worldLockIdempotencyKey.current,
      requestBody,
    );
    worldLockIdempotencyKey.current = attempt;
    setWorking(true);
    setSaveState("saving");
    setNotice("");
    try {
      const response = await fetch(
        `/api/episodes/${encodeURIComponent(projection.episode.id)}/world-lock`,
        {
          body: requestBody,
          cache: "no-store",
          headers: {
            "content-type": "application/json",
            "x-idempotency-key": attempt.key,
          },
          method: "POST",
        },
      );
      await readCommandResponse(response, "The World Lock could not be sealed.");
      worldLockIdempotencyKey.current = null;
      setSaveState("saved");
      setNotice("World Lock sealed atomically. Monica now has the production baton.");
      refreshIntoChamber("create");
    } catch (error) {
      if (error instanceof CommandMutationError && error.definitive) {
        worldLockIdempotencyKey.current = null;
        setSaveState("rejected");
        setNotice(error.message);
      } else {
        setSaveState("unconfirmed");
        setNotice(
          "The World Lock outcome is unconfirmed. Production remains fail-closed while Monica reconciles the immutable run record.",
        );
      }
      refreshIntoChamber("create");
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
        <div className="creation-title-context">
          <strong>{projection.episode.title}</strong>
          <span aria-hidden="true">,</span>
          <small>{projection.episode.seriesTitle}</small>
        </div>
        {saveState !== "idle" ? (
          <span aria-hidden="true" className={`creation-save-state is-${saveState}`}>
            <i aria-hidden="true" />
            <span className="save-state-long">{saveStateLong}</span>
            <span className="save-state-short">{saveStateShort}</span>
          </span>
        ) : (
          <span aria-hidden="true" />
        )}
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
              : item.id === "world"
                ? worldConfigurationReady
                : item.id === "preflight"
                  ? worldReady
                  : item.id === "create"
                    ? quoteConfirmed && preflightReady
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

      <aside
        aria-live="polite"
        className={`agent-activity${working || activeWorldProgress ? " is-working" : ""}`}
      >
        <span className="agent-activity-orbit" aria-hidden="true">
          <i />
          <i />
          <strong>AI</strong>
        </span>
        <span>
          <small>{agentActivity.sequence}</small>
          <strong>{agentActivity.name}</strong>
          <em>{agentActivity.action}</em>
        </span>
      </aside>

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
            {!scriptLocked ? (
              <div className="script-source-choice">
                <span>Paste or type below, or load an exact text file.</span>
                <label>
                  <span>Upload .txt</span>
                  <input
                    accept=".txt,text/plain"
                    disabled={working || !canEditCreation}
                    onChange={(event) => void loadUploadedScript(event)}
                    type="file"
                  />
                </label>
                {uploadedScript ? (
                  <strong title={uploadedScript.fileName}>
                    {uploadedScript.fileName} loaded (
                    {uploadedScript.sourceByteLength.toLocaleString()} source bytes)
                  </strong>
                ) : null}
              </div>
            ) : null}
            <label className="script-canvas">
              <span>Hindi background narration</span>
              <textarea
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
                  aria-label="Sealed Hindi background narration"
                  lang="hi"
                  tabIndex={0}
                >
                  {rawText}
                </pre>
              ) : null}
              <footer>
                <span>
                  {uploadedScript
                    ? `${uploadedScript.sourceByteLength.toLocaleString()} original source bytes; ${scriptByteLength.toLocaleString()} decoded UTF-8 bytes`
                    : `${scriptByteLength.toLocaleString()} / ${MAX_BROWSER_SCRIPT_UTF8_BYTES.toLocaleString()} exact UTF-8 bytes`}
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
              aria-busy={working}
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
              Voice
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
              Look
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
                  aria-busy={working}
                  className="creation-secondary"
                  disabled={
                    working ||
                    !worldConfigurationReady ||
                    emptyLookResults ||
                    pendingLookId !== selectedLookId
                  }
                  onClick={() => void beginWorldBuild()}
                  ref={worldActionRef}
                  type="button"
                >
                  World
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
          <WorldStudio
            canEdit={canEditCreation}
            onAccept={(entity) => void decideWorldCandidate(entity, "accept", null)}
            onContinue={() => setChamber("preflight")}
            onStart={() => void beginWorldBuild()}
            onRegenerate={(entity, revisedPromptText) =>
              void decideWorldCandidate(entity, "regenerate", revisedPromptText)
            }
            onUpload={(entity, file) => void uploadWorldCandidate(entity, file)}
            optimisticAcceptedKeys={optimisticAcceptedWorldKeys}
            pendingOperations={worldOperations}
            projection={projection.world}
            stageHeadingRef={stageHeadingRef}
            working={working}
          />
        ) : null}

        {chamber === "preflight" ? (
          <PreflightStudio
            canEdit={canEditCreation}
            onAppointReviewer={() => void appointCulturalReviewer()}
            onConfirmQuote={() => void confirmProductionQuote()}
            onContinue={() => setChamber("create")}
            onSourceReview={(decision, rationale) =>
              void decideSourceReview(decision, rationale)
            }
            projection={projection.preflight}
            stageHeadingRef={stageHeadingRef}
            working={working}
          />
        ) : null}

        {chamber === "create" ? (
          <CreationLaunchpad
            canEdit={canEditCreation}
            episodeId={projection.episode.id}
            onLock={() => void lockWorld()}
            preflight={projection.preflight}
            stageHeadingRef={stageHeadingRef}
            working={working}
            worldReady={worldReady}
          />
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
