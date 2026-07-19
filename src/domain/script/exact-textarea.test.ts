import { describe, expect, it } from "vitest";

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
} from "./exact-textarea";

describe("exact textarea reconciliation", () => {
  it("maps normalized textarea offsets across CRLF and CR source endings", () => {
    const exact = "A\r\nB\rC\nD";

    expect(textareaDisplayText(exact)).toBe("A\nB\nC\nD");
    expect(exactOffsetAtTextareaOffset(exact, 2)).toBe(3);
    expect(exactOffsetAtTextareaOffset(exact, 4)).toBe(5);
    expect(exactOffsetAtTextareaOffset(exact, 8)).toBe(exact.length);
  });

  it("splices exact clipboard bytes at normalized selection offsets", () => {
    expect(spliceExactTextareaText("A\r\nBX", 3, 4, "\r\nC\r\n")).toBe(
      "A\r\nB\r\nC\r\n",
    );
  });

  it("preserves unchanged CRLF while reconciling later DOM edits", () => {
    const exact = "before\r\nmiddle\r\nafter";

    expect(reconcileTextareaEdit(exact, "before\nmiddle!\nafter")).toBe(
      "before\r\nmiddle!\r\nafter",
    );
    expect(reconcileTextareaEdit(exact, textareaDisplayText(exact))).toBe(exact);
  });

  it("keeps newly typed textarea line breaks as LF without rewriting old CRLF", () => {
    expect(reconcileTextareaEdit("A\r\nB", "A\nnew\nB")).toBe("A\r\nnew\nB");
  });

  it.each([
    {
      data: "शिव",
      exactText: "A\r\nB",
      expected: "A\r\nशिवB",
      inputType: "insertText",
      textareaEnd: 2,
      textareaStart: 2,
    },
    {
      data: null,
      exactText: "A\r\nB",
      expected: "A\r\n\nB",
      inputType: "insertLineBreak",
      textareaEnd: 2,
      textareaStart: 2,
    },
    {
      data: null,
      exactText: "A\r\nB",
      expected: "AB",
      inputType: "deleteContentBackward",
      textareaEnd: 2,
      textareaStart: 1,
    },
    {
      data: null,
      exactText: "A\r\nB",
      expected: "AB",
      inputType: "deleteContentBackward",
      textareaEnd: 2,
      textareaStart: 2,
    },
    {
      data: null,
      exactText: "A\r\nB",
      expected: "AB",
      inputType: "deleteContentForward",
      textareaEnd: 1,
      textareaStart: 1,
    },
  ])("plans $inputType against exact pre-mutation coordinates", (input) => {
    expect(
      planExactTextareaBeforeInput({ ...input, isComposing: false }),
    ).toMatchObject({ kind: "apply", text: input.expected });
  });

  it("deletes the selected first displayed newline without confusing CRLF and LF", () => {
    expect(
      planExactTextareaBeforeInput({
        data: null,
        exactText: "\r\n\n",
        inputType: "deleteContentBackward",
        isComposing: false,
        textareaEnd: 1,
        textareaStart: 0,
      }),
    ).toEqual({ kind: "apply", text: "\n", textareaCaret: 0 });
  });

  it("keeps composition native and rejects ambiguous unsupported mutations", () => {
    expect(
      planExactTextareaBeforeInput({
        data: "शि",
        exactText: "A\r\nB",
        inputType: "insertCompositionText",
        isComposing: true,
        textareaEnd: 2,
        textareaStart: 2,
      }),
    ).toEqual({ kind: "native" });
    expect(
      planExactTextareaBeforeInput({
        data: null,
        exactText: "A\r\nB",
        inputType: "deleteWordBackward",
        isComposing: false,
        textareaEnd: 2,
        textareaStart: 2,
      }),
    ).toEqual({ kind: "reject" });
  });

  it("restores exact CRLF bytes through bounded application-owned undo and redo", () => {
    let history = emptyExactTextareaHistory();
    const pasted = "A\r\nB";
    history = recordExactTextareaEdit(history, "", pasted);
    const deleted = spliceExactTextareaText(pasted, 1, 2, "");
    history = recordExactTextareaEdit(history, pasted, deleted);

    const undone = undoExactTextareaEdit(history, deleted);
    expect(undone.text).toBe(pasted);
    expect(new TextEncoder().encode(undone.text)).toHaveLength(4);

    const redone = redoExactTextareaEdit(undone.history, undone.text);
    expect(redone.text).toBe(deleted);
  });

  it("clears redo on a divergent edit and leaves empty history unchanged", () => {
    const empty = emptyExactTextareaHistory();
    expect(undoExactTextareaEdit(empty, "exact")).toEqual({
      history: empty,
      text: "exact",
    });

    const withEdit = recordExactTextareaEdit(empty, "", "A\r\nB");
    const undone = undoExactTextareaEdit(withEdit, "A\r\nB");
    const diverged = recordExactTextareaEdit(undone.history, "", "different");
    expect(diverged.redo).toEqual([]);
  });

  it("bounds exact history memory without losing the newest state", () => {
    let history = emptyExactTextareaHistory();
    for (let index = 0; index < 300; index += 1) {
      history = recordExactTextareaEdit(
        history,
        `state-${index}`,
        `state-${index + 1}`,
      );
    }
    expect(history.undo).toHaveLength(256);
    expect(history.undo.at(-1)).toBe("state-299");
  });
});
