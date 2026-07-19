function isPostgresIdentifierContinuation(character) {
  if (character === undefined) return false;
  return /[A-Za-z0-9_$]/u.test(character) || character.charCodeAt(0) >= 0x80;
}

export function splitSqlStatements(source) {
  const statements = [];
  let start = 0;
  let state = "normal";
  let dollarTag = "";
  let escapeString = false;
  let blockCommentDepth = 0;

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (state === "single") {
      if (escapeString && current === "\\") index += 1;
      else if (current === "'" && next === "'") index += 1;
      else if (current === "'") {
        state = "normal";
        escapeString = false;
      }
      continue;
    }
    if (state === "double") {
      if (current === '"' && next === '"') index += 1;
      else if (current === '"') state = "normal";
      continue;
    }
    if (state === "line-comment") {
      if (current === "\n") state = "normal";
      continue;
    }
    if (state === "block-comment") {
      if (current === "/" && next === "*") {
        blockCommentDepth += 1;
        index += 1;
      } else if (current === "*" && next === "/") {
        blockCommentDepth -= 1;
        index += 1;
        if (blockCommentDepth === 0) state = "normal";
      }
      continue;
    }
    if (state === "dollar") {
      if (source.startsWith(dollarTag, index)) {
        state = "normal";
        index += dollarTag.length - 1;
      }
      continue;
    }

    if (current === "'") {
      const prefix = source[index - 1];
      const beforePrefix = source[index - 2];
      escapeString =
        (prefix === "E" || prefix === "e") &&
        (index < 2 || !/[A-Za-z0-9_$]/u.test(beforePrefix));
      state = "single";
    } else if (current === '"') state = "double";
    else if (current === "-" && next === "-") {
      state = "line-comment";
      index += 1;
    } else if (current === "/" && next === "*") {
      state = "block-comment";
      blockCommentDepth = 1;
      index += 1;
    } else if (
      current === "$" &&
      !isPostgresIdentifierContinuation(source[index - 1])
    ) {
      const match = source.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (match) {
        dollarTag = match[0];
        state = "dollar";
        index += dollarTag.length - 1;
      }
    } else if (current === ";") {
      statements.push(source.slice(start, index + 1));
      start = index + 1;
    }
  }

  if (state !== "normal" && state !== "line-comment") {
    throw new Error("pgTAP SQL contains an unterminated quoted value or comment.");
  }
  if (withoutLeadingComments(source.slice(start))) {
    throw new Error("Every pgTAP SQL statement must end with a semicolon.");
  }
  return statements;
}

function withoutLeadingComments(statement) {
  let index = 0;
  while (index < statement.length) {
    while (/\s/u.test(statement[index] ?? "")) index += 1;
    if (statement.startsWith("--", index)) {
      const newline = statement.indexOf("\n", index + 2);
      index = newline < 0 ? statement.length : newline + 1;
      continue;
    }
    if (statement.startsWith("/*", index)) {
      let depth = 1;
      index += 2;
      while (index < statement.length && depth > 0) {
        if (statement.startsWith("/*", index)) {
          depth += 1;
          index += 2;
        } else if (statement.startsWith("*/", index)) {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      if (depth !== 0) {
        throw new Error("pgTAP SQL contains an unterminated block comment.");
      }
      continue;
    }
    break;
  }
  return statement.slice(index).trim();
}

function analyzePgTapTransaction(query, testFile) {
  const statements = splitSqlStatements(query);
  const executable = statements.map(withoutLeadingComments);
  const beginIndexes = executable
    .map((statement, index) => (/^begin\s*;$/iu.test(statement) ? index : -1))
    .filter((index) => index >= 0);
  const rollbackIndexes = executable
    .map((statement, index) => (/^rollback\s*;$/iu.test(statement) ? index : -1))
    .filter((index) => index >= 0);
  if (beginIndexes.length !== 1 || beginIndexes[0] !== 0) {
    throw new Error(
      `pgTAP file ${testFile} must have exactly one BEGIN as its first statement.`,
    );
  }
  if (rollbackIndexes.length !== 1 || rollbackIndexes[0] !== executable.length - 1) {
    throw new Error(
      `pgTAP file ${testFile} must have exactly one ROLLBACK as its last statement.`,
    );
  }

  const plans = executable
    .map((statement, index) => {
      const match = statement.match(/^select\s+plan\s*\(\s*(\d+)\s*\)\s*;$/iu);
      return match ? { index, planned: Number.parseInt(match[1], 10) } : null;
    })
    .filter(Boolean);
  if (
    plans.length !== 1 ||
    !Number.isSafeInteger(plans[0].planned) ||
    plans[0].planned < 1
  ) {
    throw new Error(
      `pgTAP file ${testFile} must contain exactly one valid plain plan() call.`,
    );
  }

  const finishIndexes = executable
    .map((statement, index) =>
      /^select\s+\*\s+from\s+finish\s*\(\s*\)\s*;$/iu.test(statement) ? index : -1,
    )
    .filter((index) => index >= 0);
  if (finishIndexes.length !== 1 || finishIndexes[0] !== executable.length - 2) {
    throw new Error(
      `pgTAP file ${testFile} must contain exactly one plain finish() immediately before ROLLBACK.`,
    );
  }
  if (plans[0].index >= finishIndexes[0]) {
    throw new Error(`pgTAP file ${testFile} must plan before it finishes.`);
  }

  return {
    executable,
    finishIndex: finishIndexes[0],
    planned: plans[0].planned,
    statements,
  };
}

export function getPlannedPgTapAssertions(query, testFile) {
  return analyzePgTapTransaction(query, testFile).planned;
}

export function hardenPgTapQuery(query, testFile) {
  const { executable, finishIndex, statements } = analyzePgTapTransaction(
    query,
    testFile,
  );
  let captureSequence = 0;
  const hardened = [];

  for (const [index, statement] of statements.entries()) {
    const current = executable[index];
    if (index === 0) {
      hardened.push(statement);
      hardened.push(`
create temp table pg_temp.genie_tap_output (
  sequence bigint primary key,
  line text not null
) on commit drop;
grant insert, select on pg_temp.genie_tap_output to public;
`);
      continue;
    }
    if (index === statements.length - 1) {
      hardened.push(
        "select line from pg_temp.genie_tap_output order by sequence;\n",
        statement,
      );
      continue;
    }
    if (!/^select\b/iu.test(current)) {
      hardened.push(statement);
      continue;
    }

    const selectStatement = (
      index === finishIndex
        ? current.replace(/finish\s*\(\s*\)/iu, "finish(true)")
        : current
    ).replace(/;\s*$/u, "");
    captureSequence += 1;
    hardened.push(`
insert into pg_temp.genie_tap_output (sequence, line)
select ${captureSequence}, genie_tap_result.tap_result::text
from (
${selectStatement}
) as genie_tap_result(tap_result);
`);
  }

  return hardened.join("");
}

function exactManagementApiLines(result, testFile) {
  if (!Array.isArray(result) || result.length === 0) {
    throw new Error(`pgTAP file ${testFile} returned no Management API result rows.`);
  }
  return result.flatMap((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(
        `pgTAP file ${testFile} returned a non-object row at index ${index}.`,
      );
    }
    const keys = Object.keys(row);
    if (keys.length !== 1 || keys[0] !== "line" || typeof row.line !== "string") {
      throw new Error(
        `pgTAP file ${testFile} returned an unexpected Management API row schema at index ${index}.`,
      );
    }
    return row.line
      .split(/\r?\n/u)
      .map((value) => value.trim())
      .filter(Boolean);
  });
}

export function assertCompletePgTapResult(result, planned, testFile) {
  if (!Number.isSafeInteger(planned) || planned < 1) {
    throw new Error(`pgTAP file ${testFile} has an invalid plan.`);
  }
  const lines = exactManagementApiLines(result, testFile);
  const failure = lines.find((line) => /^(?:not ok\b|Bail out!)/i.test(line));
  if (failure) {
    throw new Error(`pgTAP file ${testFile} reported failure: ${failure}`);
  }
  const planLines = lines.filter((line) => /^1\.\.\d+$/.test(line));
  if (planLines.length !== 1 || planLines[0] !== `1..${planned}`) {
    throw new Error(
      `pgTAP file ${testFile} did not return its exact 1..${planned} plan.`,
    );
  }
  const assertionNumbers = lines
    .map((line) => line.match(/^ok\s+(\d+)(?:\s+-\s+.*)?$/i))
    .filter(Boolean)
    .map((match) => Number.parseInt(match[1], 10));
  if (
    assertionNumbers.length !== planned ||
    assertionNumbers.some((number, index) => number !== index + 1)
  ) {
    throw new Error(
      `pgTAP file ${testFile} did not return exactly ordered assertions 1..${planned}: ${JSON.stringify(result).slice(0, 2_000)}`,
    );
  }
}
