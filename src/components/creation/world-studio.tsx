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
  readonly onRegenerate: (entity: WorldEntity, revisedPromptText: string) => void;
  readonly onUpload: (entity: WorldEntity, file: File) => void;
  readonly projection: CreationWorldProjection;
  readonly stageHeadingRef: RefObject<HTMLHeadingElement | null>;
  readonly working: boolean;
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
  onRegenerate,
  onUpload,
  projection,
  stageHeadingRef,
  working,
}: WorldStudioProps) {
  const [editing, setEditing] = useState<WorldEntity | null>(null);
  const [composition, setComposition] = useState("");
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<WorldEntity | null>(null);
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
    ({ item }) => item.state === "accepted",
  ).length;
  const worldReady =
    allEntities.length > 0 &&
    acceptedCount === allEntities.length &&
    projection.referencePack?.state === "verified";

  useEffect(() => {
    if (!editing) return;
    requestAnimationFrame(() => editorRef.current?.focus());
  }, [editing]);

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
          aria-label={`${acceptedCount} of ${allEntities.length} world anchors accepted`}
        >
          <strong>{acceptedCount.toString().padStart(2, "0")}</strong>
          <span>of {allEntities.length.toString().padStart(2, "0")} anchored</span>
        </div>
      </header>

      {allEntities.length === 0 ? (
        <div className="world-empty">
          <div className="monica-orbit" aria-hidden="true">
            <i />
            <i />
            <i />
            <span>M</span>
          </div>
          <div>
            <small>Monica · Casting Director</small>
            <h2>The world is waiting for its first authenticated candidates.</h2>
            <p>
              Generation remains fail-closed until the provider capability and secure
              ingest workers return evidence-bound character and location anchors.
            </p>
          </div>
        </div>
      ) : (
        <div className="world-constellation">
          {allEntities.map((entity, index) => {
            const item = entity.item;
            const { composition: promptComposition, lookTail } = promptParts(
              item.promptText,
            );
            const isCharacter = entity.entityKind === "character";
            return (
              <article
                className={`world-card is-${item.state}${index % 3 === 1 ? " is-offset" : ""}`}
                key={`${entity.entityKind}:${item.entityId}`}
              >
                <div className="world-card-image">
                  <WorldAssetPreview
                    alt={`${item.name} secure visual candidate`}
                    assetVersionId={item.assetVersionId}
                    key={item.assetVersionId}
                  />
                  <span className={`world-state is-${item.state}`}>
                    {stateLabel(item.state)}
                  </span>
                  <small>
                    {entity.entityKind === "character"
                      ? "Character anchor"
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
                  {isCharacter && item.state === "accepted" ? (
                    <p
                      className={`world-evidence is-${entity.item.sheetState ?? "pending"}`}
                    >
                      Character sheet: {entity.item.sheetState ?? "being assembled"}
                    </p>
                  ) : null}
                  {entity.entityKind === "location" && entity.item.namedTemple ? (
                    <p
                      className={`world-evidence is-${entity.item.templeEvidenceSetHash ? "verified" : "pending"}`}
                    >
                      Temple reference evidence:{" "}
                      {entity.item.templeEvidenceSetHash ? "bound" : "required"}
                    </p>
                  ) : null}
                  <footer>
                    <button
                      className="world-accept"
                      disabled={!canEdit || working || item.state !== "review_required"}
                      onClick={() => onAccept(entity)}
                      type="button"
                    >
                      {item.state === "accepted" ? "Accepted" : "Accept anchor"}
                    </button>
                    <button
                      disabled={
                        !canEdit ||
                        working ||
                        !["accepted", "review_required"].includes(item.state)
                      }
                      onClick={() => openEditor(entity)}
                      type="button"
                    >
                      Edit prompt · recast
                    </button>
                    <button
                      disabled={!canEdit || working || item.state === "generating"}
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
      )}

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
              : "Monica proceeds only when every anchor and its reference pack agree."}
          </span>
        </div>
        <button
          className="creation-primary"
          disabled={!worldReady || working}
          onClick={onContinue}
          type="button"
        >
          Enter Monica’s preflight <span aria-hidden="true">→</span>
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
                  working ||
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
