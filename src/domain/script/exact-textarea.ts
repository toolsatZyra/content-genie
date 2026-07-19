import { graphemeSegments } from "unicode-segmenter/grapheme";

/**
 * Browsers expose textarea line endings as LF even when the source value used
 * CRLF or CR. These helpers keep the exact source separately while translating
 * selection offsets and ordinary DOM edits through the normalized display.
 */
export function textareaDisplayText(exactText: string): string {
  return exactText.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

export function exactOffsetAtTextareaOffset(
  exactText: string,
  textareaOffset: number,
): number {
  const boundedOffset = Math.max(
    0,
    Math.min(textareaOffset, textareaDisplayText(exactText).length),
  );
  let exactOffset = 0;
  let displayOffset = 0;

  while (exactOffset < exactText.length && displayOffset < boundedOffset) {
    if (exactText[exactOffset] === "\r") {
      exactOffset += exactText[exactOffset + 1] === "\n" ? 2 : 1;
    } else {
      exactOffset += 1;
    }
    displayOffset += 1;
  }

  return exactOffset;
}

export function spliceExactTextareaText(
  exactText: string,
  textareaStart: number,
  textareaEnd: number,
  insertedExactText: string,
): string {
  const exactStart = exactOffsetAtTextareaOffset(exactText, textareaStart);
  const exactEnd = exactOffsetAtTextareaOffset(exactText, textareaEnd);
  return exactText.slice(0, exactStart) + insertedExactText + exactText.slice(exactEnd);
}

export interface ExactTextareaBeforeInput {
  readonly data: string | null;
  readonly exactText: string;
  readonly inputType: string;
  readonly isComposing: boolean;
  readonly textareaEnd: number;
  readonly textareaStart: number;
}

export type ExactTextareaBeforeInputPlan =
  | Readonly<{
      kind: "apply";
      text: string;
      textareaCaret: number;
    }>
  | Readonly<{ kind: "native" }>
  | Readonly<{ kind: "reject" }>;

function boundedTextareaSelection(
  displayText: string,
  textareaStart: number,
  textareaEnd: number,
): readonly [number, number] {
  const start = Math.max(0, Math.min(textareaStart, displayText.length));
  const end = Math.max(0, Math.min(textareaEnd, displayText.length));
  return start <= end ? [start, end] : [end, start];
}

function previousGraphemeStart(displayText: string, textareaOffset: number): number {
  let previousStart = 0;
  for (const { index, segment } of graphemeSegments(displayText)) {
    const end = index + segment.length;
    if (textareaOffset <= end) return index;
    previousStart = index;
  }
  return previousStart;
}

function nextGraphemeEnd(displayText: string, textareaOffset: number): number {
  for (const { index, segment } of graphemeSegments(displayText)) {
    const end = index + segment.length;
    if (textareaOffset < end) return end;
  }
  return displayText.length;
}

/**
 * Plans common textarea mutations against pre-mutation selection coordinates.
 * Composition stays native so Hindi and other IMEs can manage their marked
 * ranges. Unknown mutation shapes are rejected instead of guessing across
 * normalized CRLF/LF display coordinates.
 */
export function planExactTextareaBeforeInput({
  data,
  exactText,
  inputType,
  isComposing,
  textareaEnd,
  textareaStart,
}: ExactTextareaBeforeInput): ExactTextareaBeforeInputPlan {
  if (isComposing || inputType.includes("Composition")) {
    return { kind: "native" };
  }

  const displayText = textareaDisplayText(exactText);
  let [start, end] = boundedTextareaSelection(displayText, textareaStart, textareaEnd);
  let insertedExactText = "";

  if (inputType === "insertText") {
    if (data === null) return { kind: "reject" };
    insertedExactText = data;
  } else if (inputType === "insertLineBreak" || inputType === "insertParagraph") {
    insertedExactText = "\n";
  } else if (inputType === "deleteContentBackward") {
    if (start === end && start > 0) start = previousGraphemeStart(displayText, start);
  } else if (inputType === "deleteContentForward") {
    if (start === end && end < displayText.length) {
      end = nextGraphemeEnd(displayText, end);
    }
  } else if (inputType === "deleteContent") {
    if (start === end) return { kind: "reject" };
  } else {
    return { kind: "reject" };
  }

  return {
    kind: "apply",
    text: spliceExactTextareaText(exactText, start, end, insertedExactText),
    textareaCaret: start + textareaDisplayText(insertedExactText).length,
  };
}

export interface ExactTextareaHistory {
  readonly redo: readonly string[];
  readonly undo: readonly string[];
}

export interface ExactTextareaHistoryTransition {
  readonly history: ExactTextareaHistory;
  readonly text: string;
}

const MAX_EXACT_TEXTAREA_HISTORY_ENTRIES = 256;

export function emptyExactTextareaHistory(): ExactTextareaHistory {
  return Object.freeze({ redo: Object.freeze([]), undo: Object.freeze([]) });
}

function appendHistoryEntry(
  entries: readonly string[],
  text: string,
): readonly string[] {
  return Object.freeze([...entries, text].slice(-MAX_EXACT_TEXTAREA_HISTORY_ENTRIES));
}

export function recordExactTextareaEdit(
  history: ExactTextareaHistory,
  previousText: string,
  nextText: string,
): ExactTextareaHistory {
  if (previousText === nextText) return history;
  return Object.freeze({
    redo: Object.freeze([]),
    undo: appendHistoryEntry(history.undo, previousText),
  });
}

export function undoExactTextareaEdit(
  history: ExactTextareaHistory,
  currentText: string,
): ExactTextareaHistoryTransition {
  const previousText = history.undo.at(-1);
  if (previousText === undefined) return Object.freeze({ history, text: currentText });
  return Object.freeze({
    history: Object.freeze({
      redo: appendHistoryEntry(history.redo, currentText),
      undo: Object.freeze(history.undo.slice(0, -1)),
    }),
    text: previousText,
  });
}

export function redoExactTextareaEdit(
  history: ExactTextareaHistory,
  currentText: string,
): ExactTextareaHistoryTransition {
  const nextText = history.redo.at(-1);
  if (nextText === undefined) return Object.freeze({ history, text: currentText });
  return Object.freeze({
    history: Object.freeze({
      redo: Object.freeze(history.redo.slice(0, -1)),
      undo: appendHistoryEntry(history.undo, currentText),
    }),
    text: nextText,
  });
}

export function reconcileTextareaEdit(
  previousExactText: string,
  nextTextareaText: string,
): string {
  const previousTextareaText = textareaDisplayText(previousExactText);
  if (previousTextareaText === nextTextareaText) return previousExactText;

  let sharedPrefix = 0;
  while (
    sharedPrefix < previousTextareaText.length &&
    sharedPrefix < nextTextareaText.length &&
    previousTextareaText[sharedPrefix] === nextTextareaText[sharedPrefix]
  ) {
    sharedPrefix += 1;
  }

  let sharedSuffix = 0;
  const previousRemaining = previousTextareaText.length - sharedPrefix;
  const nextRemaining = nextTextareaText.length - sharedPrefix;
  while (
    sharedSuffix < previousRemaining &&
    sharedSuffix < nextRemaining &&
    previousTextareaText[previousTextareaText.length - sharedSuffix - 1] ===
      nextTextareaText[nextTextareaText.length - sharedSuffix - 1]
  ) {
    sharedSuffix += 1;
  }

  return spliceExactTextareaText(
    previousExactText,
    sharedPrefix,
    previousTextareaText.length - sharedSuffix,
    nextTextareaText.slice(sharedPrefix, nextTextareaText.length - sharedSuffix),
  );
}
