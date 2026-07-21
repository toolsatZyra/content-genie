"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";

import type {
  CreationWorldCharacter,
  CreationWorldLocation,
  CreationWorldProgressItem,
  CreationWorldProjection,
  WorldSelectionState,
} from "@/domain/creation-readiness";
import { WorldAssetPreview } from "@/components/creation/world-asset-preview";

export type WorldEntity =
  | Readonly<{ entityKind: "character"; item: CreationWorldCharacter }>
  | Readonly<{ entityKind: "location"; item: CreationWorldLocation }>;

interface WorldStudioProps {
  readonly canEdit: boolean;
  readonly onAccept: (entity: WorldEntity) => void;
  readonly onContinue: () => void;
  readonly onStart: () => void;
  readonly onRegenerate: (entity: WorldEntity, revisedPromptText: string) => void;
  readonly onUpload: (entity: WorldEntity, file: File) => void;
  readonly optimisticAcceptedKeys: ReadonlySet<string>;
  readonly pendingOperations: Readonly<
    Record<string, "accept" | "regenerate" | "upload">
  >;
  readonly projection: CreationWorldProjection;
  readonly stageHeadingRef: RefObject<HTMLHeadingElement | null>;
  readonly working: boolean;
}

export function worldEntityKey(entity: WorldEntity): string {
  return `${entity.entityKind}:${entity.entityKind === "character" ? entity.item.formId : entity.item.entityId}`;
}

const ACTIVE_PROGRESS_STATES = new Set([
  "extracting",
  "identified",
  "researching",
  "prompted",
  "dispatched",
  "generating",
  "secure_ingest",
]);

function progressLabel(item: CreationWorldProgressItem): string {
  switch (item.state) {
    case "extracting":
      return "Reading script";
    case "identified":
      return "Identified";
    case "researching":
      return "Researching references";
    case "prompted":
      return "Prompt ready";
    case "dispatched":
      return "Sent to Nano Banana";
    case "generating":
      return "Generating image";
    case "secure_ingest":
      return "Securing result";
    case "review_ready":
      return "Ready for review";
    case "failed":
      return "Needs attention";
  }
}

function progressStep(state: CreationWorldProgressItem["state"]): number {
  if (state === "extracting") return 0;
  if (["identified", "researching", "prompted"].includes(state)) return 1;
  if (["dispatched", "generating"].includes(state)) return 2;
  if (state === "secure_ingest") return 3;
  return 4;
}

function stateLabel(state: WorldSelectionState): string {
  if (state === "review_required") return "Your review";
  if (state === "accepted") return "World anchor";
  if (state === "generating") return "Monica is recasting";
  return "Blocked";
}

function promptParts(promptText: string): Readonly<{
  composition: string;
  lookTail: string;
}> {
  const divider = promptText.indexOf("\n\n");
  if (divider < 0) return { composition: promptText, lookTail: "" };
  return {
    composition: promptText.slice(0, divider),
    lookTail: promptText.slice(divider + 2),
  };
}

function reconstructPrompt(composition: string, lookTail: string): string {
  return lookTail.length > 0 ? `${composition}\n\n${lookTail}` : composition;
}

export function WorldStudio({
  canEdit,
  onAccept,
  onContinue,
  onStart,
  onRegenerate,
  onUpload,
  optimisticAcceptedKeys,
  pendingOperations,
  projection,
  stageHeadingRef,
  working,
}: WorldStudioProps) {
  const [editing, setEditing] = useState<WorldEntity | null>(null);
  const [composition, setComposition] = useState("");
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<WorldEntity | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const allEntities = useMemo<readonly WorldEntity[]>(
    () => [
      ...projection.characters.map((item) => ({
        entityKind: "character" as const,
        item,
      })),
      ...projection.locations.map((item) => ({
        entityKind: "location" as const,
        item,
      })),
    ],
    [projection.characters, projection.locations],
  );
  const acceptedCount = allEntities.filter(
    (entity) =>
      entity.item.state === "accepted" ||
      optimisticAcceptedKeys.has(worldEntityKey(entity)),
  ).length;
  const completedWorldEntityIds = useMemo(
    () =>
      new Set(
        allEntities.flatMap((entity) =>
          entity.entityKind === "character"
            ? [entity.item.entityId, entity.item.formId]
            : [entity.item.entityId],
        ),
      ),
    [allEntities],
  );
  const entityProgress = projection.progress.filter(
    (item) =>
      item.itemKind !== "system" &&
      (item.worldEntityId === null || !completedWorldEntityIds.has(item.worldEntityId)),
  );
  const systemProgress = projection.progress.find((item) => item.itemKind === "system");
  const activeProgress = projection.progress.filter(
    (item) =>
      ACTIVE_PROGRESS_STATES.has(item.state) &&
      (item.itemKind !== "system" || item.state === "extracting"),
  );
  const failedProgress = projection.progress.filter((item) => item.state === "failed");
  const focusedProgress =
    activeProgress.find((item) => item.state === "secure_ingest") ??
    activeProgress.find((item) => item.state === "generating") ??
    activeProgress.find((item) => item.state === "dispatched") ??
    activeProgress.find((item) => item.state === "prompted") ??
    activeProgress.find((item) => item.state === "researching") ??
    activeProgress.find((item) => item.state === "extracting") ??
    activeProgress[0];
  const focusedAgent = !focusedProgress
    ? "Monica · Quality Director"
    : focusedProgress.state === "researching"
      ? "Source Keeper · Research Agent"
      : focusedProgress.state === "prompted"
        ? "Prompt Engine · Visual Prompt Agent"
        : focusedProgress.state === "dispatched"
          ? "Provider Queue · Nano Banana request sent"
          : focusedProgress.state === "generating"
            ? "Nano Banana · Image Generation AI"
            : focusedProgress.state === "secure_ingest"
              ? "Secure Media Worker"
              : "Casting Director · World Agent";
  const focusedSigil = focusedAgent.startsWith("Source")
    ? "S"
    : focusedAgent.startsWith("Prompt")
      ? "P"
      : focusedAgent.startsWith("Nano")
        ? "N"
        : focusedAgent.startsWith("Secure")
          ? "S"
          : focusedAgent.startsWith("Casting")
            ? "C"
            : "M";
  const latestUpdate = projection.progress.reduce(
    (latest, item) => Math.max(latest, Date.parse(item.updatedAt)),
    0,
  );
  const stalled = activeProgress.length > 0 && now - latestUpdate > 90_000;
  const visibleEntityCount = allEntities.length + entityProgress.length;
  const worldReady =
    allEntities.length > 0 &&
    acceptedCount === allEntities.length &&
    projection.referencePack?.state === "verified";
  const anchorsAccepted =
    allEntities.length > 0 && acceptedCount === allEntities.length;

  useEffect(() => {
    if (!editing) return;
    requestAnimationFrame(() => editorRef.current?.focus());
  }, [editing]);

  useEffect(() => {
    if (activeProgress.length === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [activeProgress.length]);

  function openEditor(entity: WorldEntity): void {
    setComposition(promptParts(entity.item.promptText).composition);
    setEditing(entity);
  }

  function submitRegeneration(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!editing || composition.trim().length === 0) return;
    const { lookTail } = promptParts(editing.item.promptText);
    onRegenerate(editing, reconstructPrompt(composition, lookTail));
    setEditing(null);
  }

  function requestUpload(entity: WorldEntity): void {
    setUploadTarget(entity);
    uploadRef.current?.click();
  }

  return (
    <section className="world-chamber">
      <header className="world-heading">
        <div>
          <span className="eyebrow">The continuity constellation</span>
          <h1 ref={stageHeadingRef} tabIndex={-1}>
            Cast once. Keep forever.
          </h1>
          <p>
            Genie has translated the sealed script and chosen look into reusable visual
            anchors. Accept, tune the composition prompt, or replace an image—without
            touching one word of the script or its locked look tail.
          </p>
        </div>
        <div
          className="world-progress"
          aria-label={`${acceptedCount} of ${visibleEntityCount} world anchors accepted`}
        >
          <strong>{acceptedCount.toString().padStart(2, "0")}</strong>
          <span>of {visibleEntityCount.toString().padStart(2, "0")} anchored</span>
        </div>
      </header>

      {projection.progress.length > 0 ? (
        <section className="world-workstream" aria-live="polite">
          <div className="monica-orbit is-working" aria-hidden="true">
            <i />
            <i />
            <i />
            <span>{focusedSigil}</span>
          </div>
          <div className="world-workstream-copy">
            <small>{focusedAgent}</small>
            <h2>
              {focusedProgress
                ? `${progressLabel(focusedProgress)} · ${focusedProgress.displayName}`
                : (systemProgress?.displayName ?? "Building the visual world")}
            </h2>
            <p>
              {focusedProgress?.safeDetail ??
                systemProgress?.safeDetail ??
                "The secure agentic AI crew is working."}
            </p>
            {stalled ? (
              <p className="world-stalled" role="status">
                This is taking longer than usual. Genie is still reconciling the run;
                you can leave this Episode and return without losing work.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {entityProgress.length > 0 ? (
        <div className="world-progress-grid">
          {entityProgress.map((item) => {
            const step = progressStep(item.state);
            return (
              <article className={`world-progress-card is-${item.state}`} key={item.id}>
                <header>
                  <span>{item.itemKind}</span>
                  <strong>{progressLabel(item)}</strong>
                </header>
                <h2>{item.displayName}</h2>
                <p>{item.safeDetail}</p>
                {item.promptText ? <blockquote>{item.promptText}</blockquote> : null}
                <ol aria-label={`Progress for ${item.displayName}`}>
                  {["Detected", "Prompt", "Generate", "Secure", "Review"].map(
                    (label, index) => (
                      <li className={index <= step ? "is-complete" : ""} key={label}>
                        <i aria-hidden="true" />
                        <span>{label}</span>
                      </li>
                    ),
                  )}
                </ol>
              </article>
            );
          })}
        </div>
      ) : null}

      {allEntities.length === 0 && projection.progress.length === 0 ? (
        <div className="world-empty">
          <div className="monica-orbit" aria-hidden="true">
            <i />
            <i />
            <i />
            <span>C</span>
          </div>
          <div>
            <small>Casting Director · World Agent</small>
            <h2>The world is waiting for its first authenticated candidates.</h2>
            <p>
              Genie will detect characters, locations and significant props, then show
              each prompt and generation step here as it happens.
            </p>
            <button
              className="creation-primary"
              disabled={!canEdit || working}
              onClick={onStart}
              type="button"
            >
              World
            </button>
          </div>
        </div>
      ) : allEntities.length === 0 &&
        activeProgress.length === 0 &&
        failedProgress.length > 0 ? (
        <div className="world-empty">
          <div className="monica-orbit" aria-hidden="true">
            <i />
            <i />
            <i />
            <span>C</span>
          </div>
          <div>
            <small>Casting Director · Recovery Agent</small>
            <h2>The locked script is safe. World needs a fresh pass.</h2>
            <p>
              Retry from the same immutable script and confirmed look. Genie will keep
              the prior attempt as audit evidence and continue in a new fenced run.
            </p>
            <button
              className="creation-primary"
              disabled={!canEdit || working}
              onClick={onStart}
              type="button"
            >
              Retry World
            </button>
          </div>
        </div>
      ) : allEntities.length > 0 ? (
        <div className="world-constellation">
          {allEntities.map((entity, index) => {
            const item = entity.item;
            const entityKey = worldEntityKey(entity);
            const pendingOperation = pendingOperations[entityKey];
            const displayedState = optimisticAcceptedKeys.has(entityKey)
              ? "accepted"
              : item.state;
            const { composition: promptComposition, lookTail } = promptParts(
              item.promptText,
            );
            const isCharacter = entity.entityKind === "character";
            const isProp =
              entity.entityKind === "location" &&
              entity.item.worldObjectKind === "prop";
            return (
              <article
                aria-busy={pendingOperation !== undefined}
                className={`world-card is-${displayedState}`}
                key={`${entity.entityKind}:${item.entityId}`}
              >
                <div className="world-card-image">
                  <WorldAssetPreview
                    alt={`${item.name} secure visual candidate`}
                    assetVersionId={item.assetVersionId}
                    key={item.assetVersionId}
                  />
                  <span className={`world-state is-${displayedState}`}>
                    {pendingOperation === "accept"
                      ? "Accepting anchor"
                      : pendingOperation === "regenerate"
                        ? "Sending recast"
                        : pendingOperation === "upload"
                          ? "Securing upload"
                          : stateLabel(displayedState)}
                  </span>
                  <small>
                    {entity.entityKind === "character"
                      ? "Character anchor"
                      : isProp
                        ? "Story prop anchor"
                        : entity.item.namedTemple
                          ? "Verified temple world"
                          : "Location anchor"}
                  </small>
                </div>
                <div className="world-card-body">
                  <header>
                    <div>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <h2>{item.name}</h2>
                    </div>
                    {isCharacter ? <em>{entity.item.formKey}</em> : null}
                  </header>
                  <p>{promptComposition}</p>
                  <div className="world-prompt-lock">
                    <span aria-hidden="true">⌁</span>
                    <small>
                      {lookTail
                        ? "Look tail cryptographically pinned"
                        : "Look tail evidence missing"}
                    </small>
                  </div>
                  {isCharacter && displayedState === "accepted" ? (
                    <p
                      className={`world-evidence is-${entity.item.sheetState ?? "pending"}`}
                    >
                      Character sheet: {entity.item.sheetState ?? "being assembled"}
                    </p>
                  ) : null}
                  {entity.entityKind === "location" &&
                  (entity.item.namedTemple || entity.item.templeEvidenceSetHash) ? (
                    <p
                      className={`world-evidence is-${entity.item.templeEvidenceSetHash ? "verified" : "pending"}`}
                    >
                      Real-world reference evidence:{" "}
                      {entity.item.templeEvidenceSetHash ? "bound" : "required"}
                    </p>
                  ) : null}
                  <footer>
                    <button
                      className="world-accept"
                      disabled={
                        !canEdit ||
                        pendingOperation !== undefined ||
                        displayedState !== "review_required"
                      }
                      onClick={() => onAccept(entity)}
                      type="button"
                    >
                      {displayedState === "accepted"
                        ? "Accepted"
                        : pendingOperation === "accept"
                          ? "Acceptingâ€¦"
                          : "Accept anchor"}
                    </button>
                    <button
                      disabled={
                        !canEdit ||
                        pendingOperation !== undefined ||
                        !["accepted", "review_required"].includes(displayedState)
                      }
                      onClick={() => openEditor(entity)}
                      type="button"
                    >
                      Edit prompt · recast
                    </button>
                    <button
                      disabled={
                        !canEdit ||
                        pendingOperation !== undefined ||
                        displayedState === "generating"
                      }
                      onClick={() => requestUpload(entity)}
                      type="button"
                    >
                      Upload your own
                    </button>
                  </footer>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      <input
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file && uploadTarget) onUpload(uploadTarget, file);
          event.currentTarget.value = "";
          setUploadTarget(null);
        }}
        ref={uploadRef}
        type="file"
      />

      <footer className="world-lock-strip">
        <div>
          <small>Reference pack</small>
          <strong>{projection.referencePack?.state ?? "not assembled"}</strong>
          <span>
            {worldReady
              ? "Every accepted anchor is versioned and ready for preflight."
              : anchorsAccepted
                ? "All anchors are accepted. Genie will assemble the reference pack now."
                : "Monica proceeds only when every anchor and its reference pack agree."}
          </span>
        </div>
        <button
          className="creation-primary"
          disabled={!anchorsAccepted || working}
          onClick={onContinue}
          type="button"
        >
          Preflight
        </button>
      </footer>

      {editing ? (
        <div className="world-editor-backdrop">
          <form
            aria-labelledby="world-editor-title"
            aria-modal="true"
            className="world-editor"
            onSubmit={submitRegeneration}
            role="dialog"
          >
            <button
              aria-label="Close prompt editor"
              className="world-editor-close"
              onClick={() => setEditing(null)}
              type="button"
            >
              ×
            </button>
            <span className="eyebrow">Recast {editing.item.name}</span>
            <h2 id="world-editor-title">
              Direct the composition. Keep the visual DNA.
            </h2>
            <label>
              <span>Scene composition · editable</span>
              <textarea
                maxLength={12_000}
                onChange={(event) => setComposition(event.target.value)}
                ref={editorRef}
                rows={9}
                value={composition}
              />
            </label>
            <div className="world-locked-tail">
              <span aria-hidden="true">◇</span>
              <div>
                <small>Selected look tail · locked</small>
                <p>
                  {promptParts(editing.item.promptText).lookTail ||
                    "Look-tail evidence is missing; regeneration will remain blocked by Monica."}
                </p>
              </div>
            </div>
            <footer>
              <button onClick={() => setEditing(null)} type="button">
                Keep current anchor
              </button>
              <button
                className="creation-primary"
                disabled={
                  pendingOperations[worldEntityKey(editing)] !== undefined ||
                  composition.trim().length === 0 ||
                  promptParts(editing.item.promptText).lookTail.length === 0
                }
                type="submit"
              >
                Regenerate this anchor
              </button>
            </footer>
          </form>
        </div>
      ) : null}
    </section>
  );
}
