import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const readJson = (file) => JSON.parse(read(file));

const markdown = read("docs/traceability.md");
const plan = read("docs/implementation-plan.md");
const qcContract = read("docs/qc-release-contract.md");
const threatContract = read("docs/threat-model.md");
const verificationContract = read("docs/verification-matrix.md");
const evidenceSource = readJson(
  "reference/acceptance/traceability-evidence.v1.json",
);
const evidenceSchema = readJson(
  "reference/acceptance/traceability-evidence.schema.json",
);

const statusVocabulary = [
  "unimplemented",
  "implemented_unverified",
  "verified",
  "failed",
  "deferred_external",
  "superseded",
];
const allowedStatuses = new Set(statusVocabulary);
const persistedStatuses = new Set(statusVocabulary.slice(1));
const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const canonicalDefinitionHash = ({
  requirementId,
  source,
  rationale,
  designContract,
  obligation,
}) =>
  sha256(
    JSON.stringify({
      requirementId,
      source,
      rationale,
      designContract,
      checkpoint: obligation.checkpoint,
      workPackages: [...obligation.workPackages].sort(),
      plannedCodeOrSchemaOwner: obligation.plannedCodeOrSchemaOwner,
      automatedProof: obligation.automatedProof,
      manualProof: obligation.manualProof,
    }),
  );

if (
  evidenceSource.schemaVersion !== "traceability-evidence.v1" ||
  !evidenceSource.entries ||
  typeof evidenceSource.entries !== "object" ||
  Array.isArray(evidenceSource.entries) ||
  evidenceSchema?.properties?.schemaVersion?.const !==
    "traceability-evidence.v1"
) {
  throw new Error("Invalid traceability evidence source/schema version");
}

const productDescriptions = {
  "GEN-PROD-001":
    "Preserve the exact submitted script; additions are typed sidecars.",
  "GEN-PROD-002":
    "Use a Hindi narration-only launch profile with no dialogue or lip-sync.",
  "GEN-PROD-003": "Produce a 60-120 second 9:16 launch master.",
  "GEN-PROD-004":
    "Let the user choose male or female narration, with male as default.",
  "GEN-PROD-005":
    "Use the supplied persistent ElevenLabs voice identities.",
  "GEN-PROD-006":
    "Offer exactly 117 looks with the mythology look selected by default.",
  "GEN-PROD-007":
    "Generate character/location candidates with accept, prompt-edit, regenerate, and upload.",
  "GEN-PROD-008":
    "Generate character sheets from accepted immutable character versions.",
  "GEN-PROD-009":
    "Research named temples from real architectural references and preserve provenance.",
  "GEN-PROD-010":
    "Atomically lock the Series world, configuration, quote, budget, and run before production.",
  "GEN-PROD-011":
    "Run the production middle autonomously without routine human operation.",
  "GEN-PROD-012":
    "Evaluate cinematic engagement, continuity, glitches, narration, score, SFX, and final-film quality.",
  "GEN-PROD-013":
    "Use Monica for provisional machine QC without approval or release authority.",
  "GEN-PROD-014":
    "Require separate qualified cultural and creative/final human approvals for every launch master.",
  "GEN-PROD-015":
    "Accept multiple timecoded plain-language repair feedback rows.",
  "GEN-PROD-016":
    "Create a new repair candidate, return it to qualified cultural review, and require a fresh separate creative/final decision without auto-approval.",
  "GEN-PROD-017":
    "Organize Episodes in Series with exact released-world inheritance and reviewed outcome commits.",
  "GEN-PROD-018":
    "Support concurrent users and multiple Episodes safely.",
  "GEN-PROD-019":
    "Search and retrieve prior Series, Episodes, assets, and downloads.",
  "GEN-PROD-020":
    "Export immutable approved packages and revoke future access after quarantine or withdrawal.",
  "GEN-PROD-021":
    "Route simple motion to Kling 2.5, camera-led motion to Kling 3.0, and other clips to Seedance.",
  "GEN-PROD-022":
    "Optimize for quality, then cost, then speed, with the stated Episode cost policy.",
  "GEN-PROD-023": "Support the launch target of five Episodes per day.",
  "GEN-PROD-024":
    "Persist diagnostics in Supabase without Sentry and permit internal downloads.",
  "GEN-PROD-025":
    "Deliver the distinctive, fluid, responsive, accessible Living Cinema experience.",
};

const qcDescriptions = {};
for (const match of qcContract.matchAll(
  /^\|\s*`(AC-QC-\d{3})`\s*\|\s*([^|]+?)\s*\|/gm,
)) {
  qcDescriptions[match[1]] = match[2].trim();
}

const threatDescriptions = {};
for (const match of threatContract.matchAll(
  /^\|\s*TM-(\d{2})\s*\|\s*([^|]+?)\s*\|/gm,
)) {
  threatDescriptions[`TM-${match[1]}`] = match[2].trim();
}

const normativeDescriptions = {};
for (const match of qcContract.matchAll(
  /^\|\s*`((?:GQC|CAL)-[A-Z]+-\d{3})`\s*\|\s*([^|]+?)\s*\|/gm,
)) {
  normativeDescriptions[match[1]] = match[2].trim();
}
normativeDescriptions["GQC-CONFIG-001"] =
  "Pinned rubric/config schema, ID, version, and SHA values must match before authoritative work.";
normativeDescriptions["CAL-RUBRIC-001"] =
  "The predeclared rubric calibration and untouched holdout gate must pass before product-calibrated claims.";

const workPackagePattern = /`((?:P[0-4]|D|C)-\d{2})`/g;
const taskIds = [
  ...plan.matchAll(/#{3,4} `((?:P[0-4]|D|C)-\d{2})`/g),
].map((match) => match[1]);
const taskIdSet = new Set(taskIds);
if (taskIdSet.size !== taskIds.length) {
  throw new Error("Implementation work-package IDs must be unique");
}

const checkpointForTask = (task) => {
  if (task.startsWith("D-")) return "deployment";
  if (task.startsWith("C-")) return "product_calibrated";
  return `phase${task.slice(1, 2)}`;
};

const sourceFor = (id) => {
  if (id.startsWith("GEN-PROD-")) {
    return {
      source: "User launch objective as normalized in the product design",
      rationale: productDescriptions[id],
    };
  }
  if (id.startsWith("AC-QC-")) {
    return {
      source:
        "docs/qc-release-contract.md - Implementation acceptance criteria",
      rationale: qcDescriptions[id],
    };
  }
  if (id.startsWith("TM-")) {
    return {
      source: "docs/threat-model.md - Threat and abuse matrix",
      rationale: threatDescriptions[id],
    };
  }
  return {
    source: "docs/qc-release-contract.md - Normative operational rule",
    rationale: normativeDescriptions[id],
  };
};

const proof = (plannedCodeOrSchemaOwner, automatedProof, manualProof = "none") => ({
  plannedCodeOrSchemaOwner,
  automatedProof,
  manualProof,
});

// Every multi-checkpoint ledger item must have an explicit proof for each
// checkpoint. The generator refuses to clone a parent proof across phases.
const checkpointProofOverrides = {
  "GEN-PROD-001": {
    phase2: proof(
      "src/domain/script/integrity.ts; migration 0010",
      "V-P2-001, V-P2-002, V-P2-003, V-P2-004 source/hash/map/mutation suite",
      "exact-source diff review",
    ),
    phase3: proof(
      "src/domain/narration/reconciliation.ts; migration 0034",
      "V-P3-007 spoken-word reconciliation",
      "locked-script/narration listening spot check",
    ),
  },
  "GEN-PROD-002": {
    phase2: proof(
      "src/domain/profile/launch-profile.ts",
      "narration-only applicability and lip-sync-not-applicable tests",
      "creation-flow inspection",
    ),
    phase3: proof(
      "src/domain/narration/adapter.ts",
      "no-dialogue provider/EDD contract tests",
    ),
  },
  "GEN-PROD-003": {
    phase2: proof(
      "src/domain/narration/master-clock.ts; migration 0020",
      "V-P2-020 60.000/120.000 boundary and aspect-plan tests",
      "preflight narration playback",
    ),
    phase3: proof(
      "src/domain/render/master.ts; migration 0036",
      "V-P3-015 and V-P3-016 master ffprobe/duration/9:16 tests",
      "machine-ready master playback",
    ),
    phase4: proof(
      "src/domain/export/package.ts; migration 0043",
      "V-P4-017 exported MP4 probe/duration/9:16 tests",
      "exported master playback",
    ),
  },
  "GEN-PROD-005": {
    phase2: proof(
      "src/domain/voice/voice-registry.ts; migrations 0011,0017",
      "V-P2-005 exact ID/default/no-fallback tests",
    ),
    deployment: proof(
      "infrastructure/canaries/voice.ts",
      "V-D-004 authenticated male/female voice canaries",
      "Hindi/Sanskrit voice canary review",
    ),
  },
  "GEN-PROD-011": {
    phase2: proof(
      "src/domain/preflight; migration 0015",
      "V-P2-027 durable preflight crash/lease/reconciliation matrix",
      "preflight operations review",
    ),
    phase3: proof(
      "trigger/control; src/domain/runs",
      "full autonomous run/interrupt/resume/fail-closed journey",
      "production operations review",
    ),
  },
  "GEN-PROD-012": {
    phase2: proof(
      "src/domain/sound/policy.ts; migration 0014",
      "pronunciation/score/sound identity and plan-policy fixtures",
      "sound-policy inspection",
    ),
    phase3: proof(
      "src/domain/qc; migrations 0033..0036",
      "all Phase-3 GQC/media/consensus/regression fixtures",
      "blind machine-ready master review",
    ),
    product_calibrated: proof(
      "tests/calibration/cal-rubric-001.ts; docs/evidence/calibration",
      "CAL-RUBRIC-001 30-Episode calibration plus 20 untouched holdout report",
      "independent creative and qualified cultural benchmark review",
    ),
  },
  "GEN-PROD-013": {
    phase3: proof(
      "src/domain/agents/monica.ts; src/domain/qc",
      "machine-pass cannot mutate approval/release authority tests",
      "Monica provisional-state evidence review",
    ),
    phase4: proof(
      "src/domain/approvals; migrations 0040,0041",
      "V-P4-001, V-P4-002, V-P4-003, V-P4-004, V-P4-005 separate record/AAL2/CAS tests",
      "authority UX review",
    ),
  },
  "GEN-PROD-017": {
    phase1: proof(
      "src/domain/series; migration 0003",
      "series/Episode identity and concurrent-number tests",
    ),
    phase2: proof(
      "src/domain/series/releases.ts; migration 0021",
      "first/later Episode inheritance and release-pin tests",
      "World Lock summary review",
    ),
    phase4: proof(
      "src/domain/continuity/outcomes.ts; migration 0044",
      "V-P4-018 outcome CAS/rebase/branch tests",
      "Series editor outcome review",
    ),
  },
  "GEN-PROD-018": {
    phase1: proof(
      "src/domain/work; migrations 0004,0005",
      "lease/fence/realtime/multi-user concurrency suite",
      "multi-user workspace review",
    ),
    phase4: proof(
      "src/domain/collaboration; migration 0045",
      "V-P4-015 concurrent claim/review tests",
      "concurrent review UX",
    ),
  },
  "GEN-PROD-019": {
    phase1: proof(
      "src/domain/library; migration 0003",
      "workspace-scoped Series/Episode retrieval tests",
      "library journey",
    ),
    phase4: proof(
      "src/domain/search; src/domain/export; migrations 0043,0045",
      "V-P4-014/V-P4-017 search/history/download tests",
      "historical retrieval/download journey",
    ),
  },
  "GEN-PROD-020": {
    phase4: proof(
      "src/domain/export; src/domain/incidents; migrations 0043,0044",
      "V-P4-011, V-P4-012, V-P4-013, V-P4-019 eligibility/checksum/revocation tests",
      "immutable package inspection",
    ),
    deployment: proof(
      "tests/deployment/full-release.ts",
      "V-D-017 deployed approval/export/revocation journey",
      "deployed package inspection",
    ),
  },
  "GEN-PROD-021": {
    phase2: proof(
      "src/domain/routing/shot-router.ts; migration 0020",
      "simple/camera-led/other deterministic route table",
    ),
    phase3: proof(
      "src/domain/providers/video.ts; migration 0031",
      "V-P3-009 provider adapter routing fixtures",
      "authenticated route evidence review",
    ),
  },
  "GEN-PROD-022": {
    phase2: proof(
      "src/domain/cost/preflight.ts; migrations 0017,0019",
      "micro/exact quote/slot/reservation concurrency suite",
    ),
    phase3: proof(
      "src/domain/cost/settlement.ts; migration 0031",
      "retry/cancel/late/unknown/refund settlement tests",
    ),
    deployment: proof(
      "tests/deployment/cost-qualification.ts",
      "V-D-008/V-D-009 predeclared cost qualification",
      "cost program review",
    ),
  },
  "GEN-PROD-023": {
    phase3: proof(
      "trigger/queues; src/domain/render",
      "render capacity, disk, fairness, queue-age, cancellation tests",
    ),
    deployment: proof(
      "tests/deployment/five-episode-load.ts",
      "V-D-007 five overlapping Episodes with degraded provider",
      "capacity qualification review",
    ),
  },
  "GEN-PROD-024": {
    phase0: proof(
      "src/observability; src/config",
      "diagnostic schema/redaction/no-Sentry tests",
    ),
    phase4: proof(
      "src/domain/diagnostics; src/domain/export; migrations 0043,0045",
      "Supabase diagnostic persistence and authorized download tests",
      "diagnostic dashboard/package review",
    ),
  },
  "GEN-PROD-025": {
    phase1: proof(
      "src/app/(studio); src/components/studio-shell",
      "workspace shell browser/axe/responsive/state matrix",
      "Living Cinema shell review",
    ),
    phase2: proof(
      "src/app/(studio)/episodes/[id]/create",
      "V-P2-026 creation journey browser/axe/visual matrix",
      "creation-flow design review",
    ),
    phase3: proof(
      "src/app/(studio)/episodes/[id]/production",
      "production-monitor browser/axe/visual/failure-state matrix",
      "operations UI review",
    ),
    phase4: proof(
      "src/app/(studio)/episodes/[id]/review",
      "V-P4-016/V-P4-024 review/repair state matrix",
      "Premiere and Repair Room design review",
    ),
  },
  "AC-QC-001": {
    phase2: proof(
      "src/domain/qc/config.ts",
      "Phase-2 corrupt schema/ID/version/SHA fixtures",
    ),
    phase3: proof(
      "src/domain/qc/config.ts",
      "Phase-3 runtime config/hash mismatch fixtures",
    ),
  },
  "AC-QC-002": {
    phase2: proof(
      "src/domain/qc/evidence.ts; migration 0020",
      "preflight required-pin schema tests",
    ),
    phase3: proof(
      "src/domain/qc/evidence.ts; migration 0035",
      "master verdict required-pin schema tests",
      "master evidence inspection",
    ),
  },
  "AC-QC-003": {
    phase2: proof("src/domain/qc/scoring.ts", "preflight golden scoring cases"),
    phase3: proof("src/domain/qc/scoring.ts", "master golden scoring replay"),
  },
  "AC-QC-004": {
    phase2: proof(
      "src/domain/qc/scoring.ts",
      "preflight context-weight normalization properties",
    ),
    phase3: proof(
      "src/domain/qc/scoring.ts",
      "master context-weight normalization properties",
    ),
  },
  "AC-QC-005": {
    phase2: proof(
      "src/domain/qc/verdict.ts",
      "preflight gate boundary fixtures",
    ),
    phase3: proof(
      "src/domain/qc/verdict.ts",
      "master visual/localization/script boundary fixtures",
    ),
  },
  "AC-QC-006": {
    phase2: proof(
      "src/domain/qc/applicability.ts",
      "preflight not-applicable projection properties",
    ),
    phase3: proof(
      "src/domain/qc/applicability.ts",
      "master not-applicable projection properties",
    ),
  },
  "AC-QC-031": {
    phase2: proof(
      "src/domain/routing/calibration-policy.ts",
      "unqualified complex-deity route disabled at plan time",
      "provider capability slice review",
    ),
    phase3: proof(
      "src/domain/providers/video.ts; src/domain/qc",
      "disabled cell cannot dispatch and fallback requires re-plan",
      "retained deity-motion slice review",
    ),
  },
  "TM-10": {
    phase1: proof(
      "supabase/migrations/0008_storage.sql",
      "cross-workspace/encoded Storage path RLS tests",
    ),
    phase2: proof(
      "src/domain/ingest/storage.ts; migration 0018",
      "quarantine/promoted path isolation tests",
    ),
  },
  "TM-12": {
    phase2: proof(
      "src/domain/ingest; src/domain/broker; migrations 0017,0018",
      "V-P2-008, V-P2-011, V-P2-031, V-P2-032, V-P2-033, V-P2-034 malicious-media and broker-scope corpus",
      "sandbox/broker boundary review",
    ),
    phase3: proof(
      "src/domain/capabilities; trigger/tasks",
      "V-P3-019/V-P3-025/V-P3-027 expired/stale/cross-project grant tests",
    ),
  },
  "TM-13": {
    phase2: proof(
      "src/domain/ingest/sanitize.ts",
      "GPS/comment/attachment stripping fixtures",
    ),
    phase4: proof(
      "src/domain/export/scanner.ts",
      "export metadata reintroduction scan",
      "exported file inspection",
    ),
  },
  "TM-15": {
    phase2: proof(
      "src/domain/agents/read-only-broker.ts",
      "V-P2-028 multi-source preflight injection corpus",
      "preflight red-team review",
    ),
    phase3: proof(
      "src/domain/agents/tool-broker.ts",
      "V-P3-021/V-P3-022 side-effect/fan-out/depth injection corpus",
      "production red-team review",
    ),
  },
  "TM-16": {
    phase2: proof(
      "src/domain/planning/graph.ts; src/domain/agents/read-only-broker.ts",
      "fabricated ID/stale version/cycle/fan-out/depth fuzz",
    ),
    phase3: proof(
      "src/domain/agents/tool-broker.ts",
      "production task graph/ID/version fuzz",
    ),
  },
  "TM-22": {
    phase2: proof(
      "src/domain/preflight; src/domain/cost; migrations 0015,0019",
      "V-P2-015, V-P2-016, V-P2-017, V-P2-032, V-P2-033, V-P2-034 micro scope/reservation/retry races",
      "micro-spend policy review",
    ),
    phase3: proof(
      "src/domain/runs; src/domain/cost",
      "V-P3-005/V-P3-006 production retry/circuit/budget tests",
      "production spend policy review",
    ),
  },
  "TM-24": {
    phase2: proof(
      "src/domain/providers/state.ts; migration 0017",
      "preflight cancel/late/billable-no-asset tests",
    ),
    phase3: proof(
      "src/domain/runs/cancel.ts; src/domain/cost/settlement.ts",
      "production cancel/late/terminal-no-reopen tests",
    ),
  },
  "TM-25": {
    phase0: proof(
      "src/observability/redaction.ts",
      "seeded canary across logs/errors/client/build surfaces",
      "Phase-0 restricted log review",
    ),
    phase3: proof(
      "src/domain/diagnostics; migration 0037",
      "seeded script/token/provider payload scan across persisted diagnostics",
      "production diagnostics review",
    ),
  },
  "TM-26": {
    phase1: proof(
      "src/domain/realtime; migration 0009",
      "Realtime/diagnostic schema,size,rate,dedupe burst tests",
    ),
    phase3: proof(
      "src/domain/diagnostics; migration 0037",
      "production inbox/dead-letter/metric flood tests",
      "operations dashboard review",
    ),
  },
  "TM-28": {
    phase2: proof(
      "src/domain/culture/source-review.ts; migration 0013",
      "source decision hash/workspace/version swap tests",
      "qualified source review",
    ),
    phase4: proof(
      "src/domain/culture/master-decision.ts; migration 0041",
      "master cultural decision replay/edit/swap tests",
      "qualified master review",
    ),
  },
  "TM-32": {
    phase1: proof(
      "src/domain/storage/signed-access.ts",
      "membership revocation and short-TTL issuance tests",
    ),
    phase4: proof(
      "src/domain/export/download.ts",
      "V-P4-013 expired/revoked/regenerated URL tests",
      "download policy review",
    ),
  },
  "TM-33": {
    phase0: proof(
      "src/config/server-env.ts",
      "publishing adapter absent/disabled in secretless build",
    ),
    phase4: proof(
      "src/domain/export; publishing remains disabled",
      "forged destination/visibility/duplicate command tests",
      "feature-flag review",
    ),
  },
  "TM-35": {
    phase0: proof(
      "src/config; CI secretless fork",
      "production-shaped project/key denial in preview config",
    ),
    phase2: proof(
      "src/domain/broker; migration 0017",
      "V-P2-031 and V-P2-034 cross-project/environment client/key/grant tests",
    ),
    deployment: proof(
      "infrastructure/environment-assertions",
      "V-D-001/V-D-003 remote environment/project isolation",
      "remote environment inventory",
    ),
  },
  "TM-36": {
    phase4: proof(
      "src/domain/recovery; migration 0046",
      "software restore/reconciliation fault fixtures",
    ),
    deployment: proof(
      "infrastructure/recovery",
      "V-D-011, V-D-012, V-D-013, V-D-014, V-D-015, V-D-016 timed remote restore/reconciliation drills",
      "recovery drill review",
    ),
  },
  "TM-38": {
    phase1: proof(
      "supabase/migrations/0006_audit.sql",
      "application-role audit update/delete/truncate tests",
    ),
    deployment: proof(
      "infrastructure/vault",
      "V-D-012 compromised Vault writer immutability tests",
      "Vault access review",
    ),
  },
  "TM-40": {
    phase1: proof(
      "src/components/studio-shell",
      "stored-XSS corpus across Series/Episode shell",
      "shell CSP/render review",
    ),
    phase2: proof(
      "src/app/(studio)/episodes/[id]/create",
      "stored-XSS corpus across script/look/world/plan UI",
      "creation CSP/render review",
    ),
    phase3: proof(
      "src/app/(studio)/episodes/[id]/production",
      "stored-XSS corpus across provider/QC/diagnostic UI",
      "operations CSP/render review",
    ),
    phase4: proof(
      "src/app/(studio)/episodes/[id]/review",
      "stored-XSS corpus across Premiere/repair/export UI",
      "review CSP/render review",
    ),
  },
};

const ledgerRows = markdown
  .split(/\r?\n/)
  .filter((line) => /^\| `(?:GEN-PROD|AC-QC|TM)-/.test(line));

const parseLedgerRequirement = (line) => {
  const cells = line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
  const id = cells[0].replaceAll("`", "");
  if (/\.\.|Phase\s*\d+\s*[–-]\s*\d+|P[0-4]-\d{2}\s*[–-]/.test(cells[2])) {
    throw new Error(`${id} uses a compact/prose task range; enumerate IDs`);
  }
  const tasks = [...cells[2].matchAll(workPackagePattern)].map(
    (match) => match[1],
  );
  if (tasks.length === 0 || new Set(tasks).size !== tasks.length) {
    throw new Error(`${id} must enumerate unique work-package IDs`);
  }
  for (const task of tasks) {
    if (!taskIdSet.has(task)) throw new Error(`${id} references unknown ${task}`);
  }
  const grouped = new Map();
  for (const task of tasks) {
    const checkpoint = checkpointForTask(task);
    const existing = grouped.get(checkpoint) ?? [];
    existing.push(task);
    grouped.set(checkpoint, existing);
  }
  const overrides = checkpointProofOverrides[id];
  if (overrides) {
    const expected = [...grouped.keys()].sort();
    const actual = Object.keys(overrides).sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      throw new Error(
        `${id} child-proof checkpoints differ: ${actual} vs ${expected}`,
      );
    }
  } else if (grouped.size > 1) {
    throw new Error(`${id} spans checkpoints without explicit child proofs`);
  }
  return {
    id,
    designContract: cells[1].replaceAll("`", ""),
    obligations: [...grouped.entries()].map(([checkpoint, workPackages]) => ({
      checkpoint,
      workPackages,
      ...(overrides?.[checkpoint] ??
        proof(
          cells[3].replaceAll("`", ""),
          `${id} ${checkpoint} - ${cells[4].replaceAll("`", "")}`,
          cells[5].replaceAll("`", "") || "none",
        )),
    })),
  };
};

const normativeAssignments = new Map();
const familyIds = (family, count) =>
  Array.from(
    { length: count },
    (_, index) => `${family}-${String(index + 1).padStart(3, "0")}`,
  );

const assignNormative = (ids, assignments) => {
  for (const id of ids) {
    if (normativeAssignments.has(id)) {
      throw new Error(`Duplicate normative assignment for ${id}`);
    }
    normativeAssignments.set(
      id,
      assignments.map((assignment) => ({
        checkpoint: assignment.checkpoint,
        workPackages: assignment.workPackages,
        plannedCodeOrSchemaOwner: `${assignment.owner}; tests/qc/rules/${id.toLowerCase()}.test.ts`,
        automatedProof: `${id} ${assignment.checkpoint} exact fixture, boundary, and fail-closed evidence assertion`,
        manualProof: assignment.manualProof ?? "none",
      })),
    );
  }
};

assignNormative(["GQC-CONFIG-001"], [
  {
    checkpoint: "phase2",
    workPackages: ["P2-11"],
    owner: "src/domain/qc/config.ts; migration 0020",
  },
  {
    checkpoint: "phase3",
    workPackages: ["P3-09"],
    owner: "src/domain/qc/config.ts; migration 0035",
  },
]);
assignNormative(
  ["GQC-SCRIPT-001", "GQC-SCRIPT-002", "GQC-SCRIPT-003", "GQC-SCRIPT-005", "GQC-SCRIPT-006"],
  [
    {
      checkpoint: "phase2",
      workPackages: ["P2-01"],
      owner: "src/domain/script/integrity.ts; migration 0010",
      manualProof: "exact-source diff review",
    },
  ],
);
assignNormative(["GQC-SCRIPT-004"], [
  {
    checkpoint: "phase2",
    workPackages: ["P2-05", "P2-09"],
    owner: "src/domain/script/claims.ts; src/domain/culture/triage.ts",
    manualProof: "qualified source-triage review",
  },
]);
assignNormative(
  ["GQC-VOICE-001", "GQC-VOICE-002", "GQC-VOICE-004", "GQC-VOICE-005", "GQC-VOICE-006", "GQC-VOICE-007", "GQC-VOICE-008", "GQC-VOICE-009"],
  [
    {
      checkpoint: "phase2",
      workPackages: ["P2-11"],
      owner: "src/domain/narration/preflight.ts; migration 0020",
      manualProof: "narration and pronunciation spot check",
    },
  ],
);
assignNormative(["GQC-VOICE-003"], [
  {
    checkpoint: "phase3",
    workPackages: ["P3-05"],
    owner: "src/domain/captions/locked-alignment.ts; migration 0034",
    manualProof: "caption playback",
  },
]);
assignNormative(
  ["GQC-WORLD-001", "GQC-WORLD-002", "GQC-WORLD-003", "GQC-WORLD-004", "GQC-WORLD-007"],
  [
    {
      checkpoint: "phase2",
      workPackages: ["P2-08", "P2-11"],
      owner: "src/domain/world; migrations 0012,0020",
      manualProof: "accepted world/reference-pack review",
    },
  ],
);
assignNormative(["GQC-WORLD-005"], [
  {
    checkpoint: "phase2",
    workPackages: ["P2-07", "P2-08", "P2-09"],
    owner: "src/domain/world/temple-evidence.ts; migrations 0013,0018",
    manualProof: "qualified temple/source review",
  },
]);
assignNormative(["GQC-WORLD-006"], [
  {
    checkpoint: "phase2",
    workPackages: ["P2-07"],
    owner: "src/domain/ingest; migration 0018",
  },
]);
assignNormative(["GQC-WORLD-008"], [
  {
    checkpoint: "phase2",
    workPackages: ["P2-08", "P2-09", "P2-11"],
    owner: "src/domain/world/release-readiness.ts; migrations 0012,0013,0020",
    manualProof: "Series-draft readiness review",
  },
]);
assignNormative(familyIds("GQC-PLAN", 11), [
  {
    checkpoint: "phase2",
    workPackages: ["P2-11"],
    owner: "src/domain/planning/qc.ts; migration 0020",
    manualProof: "plan evidence inspection",
  },
]);
assignNormative(["GQC-PLAN-012"], [
  {
    checkpoint: "phase2",
    workPackages: ["P2-12"],
    owner: "src/domain/cost/quote.ts; migration 0019",
    manualProof: "exact quote inspection",
  },
]);
assignNormative(familyIds("GQC-FRAME", 7), [
  {
    checkpoint: "phase3",
    workPackages: ["P3-06", "P3-09"],
    owner: "src/domain/qc/frame.ts; migrations 0033,0035",
    manualProof: "keyframe adjudication",
  },
]);
assignNormative(familyIds("GQC-CLIP", 7), [
  {
    checkpoint: "phase3",
    workPackages: ["P3-06", "P3-09"],
    owner: "src/domain/qc/clip.ts; migrations 0033,0035",
    manualProof: "retained-clip adjudication",
  },
]);
assignNormative(
  ["GQC-AUDIO-001", "GQC-AUDIO-002", "GQC-AUDIO-003", "GQC-AUDIO-006", "GQC-AUDIO-007"],
  [
    {
      checkpoint: "phase3",
      workPackages: ["P3-07", "P3-09"],
      owner: "src/domain/qc/audio.ts; migrations 0034,0035",
      manualProof: "mix listening review",
    },
  ],
);
assignNormative(["GQC-AUDIO-004", "GQC-AUDIO-005"], [
  {
    checkpoint: "phase3",
    workPackages: ["P3-05", "P3-09"],
    owner: "src/domain/qc/captions.ts; migrations 0034,0035",
    manualProof: "caption playback/frame review",
  },
]);
assignNormative(
  ["GQC-CONT-001", "GQC-CONT-002", "GQC-CONT-003", "GQC-CONT-004", "GQC-CONT-006"],
  [
    {
      checkpoint: "phase3",
      workPackages: ["P3-04", "P3-06", "P3-09"],
      owner: "src/domain/qc/continuity.ts; migrations 0033,0035",
      manualProof: "scene/Series continuity review",
    },
  ],
);
assignNormative(["GQC-CONT-005"], [
  {
    checkpoint: "phase3",
    workPackages: ["P3-07", "P3-09"],
    owner: "src/domain/qc/audio-continuity.ts; migrations 0034,0035",
    manualProof: "audio-boundary listening review",
  },
]);
assignNormative(familyIds("GQC-CULT", 12), [
  {
    checkpoint: "phase2",
    workPackages: ["P2-09"],
    owner: "src/domain/culture/policy.ts; migration 0013",
    manualProof: "qualified source/policy review",
  },
  {
    checkpoint: "phase3",
    workPackages: ["P3-09"],
    owner: "src/domain/qc/cultural-readiness.ts; migration 0035",
    manualProof: "provisional machine cultural evidence inspection",
  },
  {
    checkpoint: "phase4",
    workPackages: ["P4-01", "P4-02"],
    owner: "src/domain/approvals/cultural.ts; migration 0041",
    manualProof: "qualified exact-master cultural review",
  },
]);
assignNormative(["GQC-MASTER-001"], [
  {
    checkpoint: "phase3",
    workPackages: ["P3-08", "P3-09"],
    owner: "src/domain/qc/master.ts; migrations 0036,0035",
    manualProof: "machine-ready master lineage review",
  },
]);
assignNormative(
  ["GQC-MASTER-002", "GQC-MASTER-003", "GQC-MASTER-004", "GQC-MASTER-005", "GQC-MASTER-007", "GQC-MASTER-008", "GQC-MASTER-009"],
  [
    {
      checkpoint: "phase3",
      workPackages: ["P3-09"],
      owner: "src/domain/qc/master.ts; migration 0035",
      manualProof: "machine-ready master/evidence review",
    },
  ],
);
assignNormative(["GQC-MASTER-006"], [
  {
    checkpoint: "phase4",
    workPackages: ["P4-01", "P4-02"],
    owner: "src/domain/approvals/cultural.ts; migration 0041",
    manualProof: "qualified exact-master cultural decision",
  },
]);
assignNormative(["GQC-MASTER-010"], [
  {
    checkpoint: "phase4",
    workPackages: ["P4-02"],
    owner: "src/domain/approvals/final.ts; migration 0040",
    manualProof: "permitted human exact-master creative/final decision",
  },
]);
assignNormative(["GQC-REPAIR-001", "GQC-REPAIR-002"], [
  {
    checkpoint: "phase4",
    workPackages: ["P4-03"],
    owner: "src/domain/repairs/plan.ts; migration 0042",
    manualProof: "repair-plan review",
  },
]);
assignNormative(
  ["GQC-REPAIR-003", "GQC-REPAIR-004", "GQC-REPAIR-005", "GQC-REPAIR-006", "GQC-REPAIR-007", "GQC-REPAIR-008", "GQC-REPAIR-009"],
  [
    {
      checkpoint: "phase4",
      workPackages: ["P4-04"],
      owner: "src/domain/repairs/regression.ts; migration 0042",
      manualProof: "A/B repair and regression review",
    },
  ],
);
assignNormative(familyIds("GQC-EXPORT", 5), [
  {
    checkpoint: "phase4",
    workPackages: ["P4-05"],
    owner: "src/domain/export/acceptance.ts; migration 0043",
    manualProof: "export package inspection",
  },
]);
assignNormative(["CAL-RUBRIC-001"], [
  {
    checkpoint: "product_calibrated",
    workPackages: ["C-01"],
    owner: "tests/calibration/cal-rubric-001.ts; docs/evidence/calibration",
    manualProof:
      "independent 30-Episode calibration and 20-Episode untouched holdout review",
  },
]);

const normativeIds = [
  ...new Set(
    [...qcContract.matchAll(/`((?:GQC|CAL)-[A-Z]+-\d{3})`/g)].map(
      (match) => match[1],
    ),
  ),
].sort();
const assignedNormativeIds = [...normativeAssignments.keys()].sort();
if (JSON.stringify(normativeIds) !== JSON.stringify(assignedNormativeIds)) {
  const missing = normativeIds.filter((id) => !normativeAssignments.has(id));
  const extra = assignedNormativeIds.filter((id) => !normativeIds.includes(id));
  throw new Error(
    `Normative mapping mismatch missing=${missing.join(",")} extra=${extra.join(",")}`,
  );
}

const requirementPlans = ledgerRows.map(parseLedgerRequirement);
for (const id of normativeIds) {
  requirementPlans.push({
    id,
    designContract: `docs/qc-release-contract.md - ${id.replace(/-\d{3}$/, "")}`,
    obligations: normativeAssignments.get(id),
  });
}

const requirementIds = requirementPlans.map((item) => item.id);
if (new Set(requirementIds).size !== requirementIds.length) {
  throw new Error("Traceability requirement IDs must be unique");
}

const evidenceEntries = evidenceSource.entries ?? {};
const expectedEvidenceKeys = new Set();

const assertCommitContainsArtifact = (commit, artifact) => {
  const commitCheck = spawnSync(
    "git",
    ["cat-file", "-e", `${commit}^{commit}`],
    { cwd: root, encoding: "utf8" },
  );
  if (commitCheck.status !== 0) {
    throw new Error(`Evidence commit does not exist: ${commit}`);
  }
  const committedFile = spawnSync(
    "git",
    ["show", `${commit}:${artifact.path}`],
    { cwd: root, encoding: null, maxBuffer: 32 * 1024 * 1024 },
  );
  if (
    committedFile.status !== 0 ||
    !Buffer.isBuffer(committedFile.stdout) ||
    committedFile.stdout.length === 0 ||
    sha256(committedFile.stdout) !== artifact.sha256
  ) {
    throw new Error(
      `Evidence artifact is absent/different in ${commit}: ${artifact.path}`,
    );
  }
};

const validateEvidenceArtifact = (artifact, commit, obligationId) => {
  if (
    !artifact ||
    typeof artifact !== "object" ||
    Array.isArray(artifact) ||
    Object.keys(artifact).sort().join(",") !== "path,sha256" ||
    typeof artifact.path !== "string" ||
    !/^docs\/evidence\/[A-Za-z0-9._/-]+$/.test(artifact.path) ||
    artifact.path.includes("..") ||
    path.posix.normalize(artifact.path) !== artifact.path ||
    typeof artifact.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(artifact.sha256)
  ) {
    throw new Error(`${obligationId} has malformed evidence artifact`);
  }
  const absolutePath = path.resolve(root, ...artifact.path.split("/"));
  const evidenceRoot = path.resolve(root, "docs", "evidence");
  if (
    absolutePath === evidenceRoot ||
    !absolutePath.startsWith(`${evidenceRoot}${path.sep}`) ||
    !fs.existsSync(absolutePath) ||
    !fs.statSync(absolutePath).isFile() ||
    fs.statSync(absolutePath).size === 0
  ) {
    throw new Error(
      `${obligationId} evidence artifact does not exist: ${artifact.path}`,
    );
  }
  if (sha256(fs.readFileSync(absolutePath)) !== artifact.sha256) {
    throw new Error(
      `${obligationId} evidence SHA mismatch: ${artifact.path}`,
    );
  }
  if (commit) assertCommitContainsArtifact(commit, artifact);
};

const materializeObligation = (
  requirementId,
  obligation,
  definitionContext,
) => {
  const obligationId = `${requirementId}@${obligation.checkpoint}`;
  expectedEvidenceKeys.add(obligationId);
  const evidence = evidenceEntries[obligationId];
  const definitionHash = canonicalDefinitionHash({
    requirementId,
    ...definitionContext,
    obligation,
  });
  if (evidence) {
    const allowedKeys = [
      "commit",
      "evidence",
      "obligationDefinitionHash",
      "status",
      "verifiedAt",
      "workPackages",
    ];
    if (
      !evidence ||
      typeof evidence !== "object" ||
      Array.isArray(evidence) ||
      JSON.stringify(Object.keys(evidence).sort()) !==
        JSON.stringify(allowedKeys) ||
      !persistedStatuses.has(evidence.status) ||
      !Array.isArray(evidence.workPackages) ||
      evidence.workPackages.length === 0 ||
      new Set(evidence.workPackages).size !== evidence.workPackages.length ||
      !Array.isArray(evidence.evidence) ||
      evidence.evidence.length === 0 ||
      typeof evidence.obligationDefinitionHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(evidence.obligationDefinitionHash) ||
      typeof evidence.verifiedAt !== "string" ||
      Number.isNaN(Date.parse(evidence.verifiedAt)) ||
      Date.parse(evidence.verifiedAt) > Date.now() ||
      !(
        evidence.commit === null ||
        (typeof evidence.commit === "string" &&
          /^[a-f0-9]{7,40}$/i.test(evidence.commit))
      )
    ) {
      throw new Error(`${obligationId} has invalid evidence entry shape`);
    }
    const expectedPackages = [...obligation.workPackages].sort();
    const recordedPackages = [...(evidence.workPackages ?? [])].sort();
    if (JSON.stringify(expectedPackages) !== JSON.stringify(recordedPackages)) {
      throw new Error(
        `${obligationId} evidence work packages do not match current plan`,
      );
    }
    if (evidence.obligationDefinitionHash !== definitionHash) {
      throw new Error(
        `${obligationId} evidence is stale for the current obligation definition`,
      );
    }
    if (evidence.status === "verified" && !evidence.commit) {
      throw new Error(`${obligationId} verified status requires a commit`);
    }
    for (const artifact of evidence.evidence) {
      validateEvidenceArtifact(artifact, evidence.commit, obligationId);
    }
  }
  const status = evidence?.status ?? "unimplemented";
  const evidenceLinks = evidence?.evidence ?? [];
  const commit = evidence?.commit ?? null;
  const verifiedAt = evidence?.verifiedAt ?? null;
  if (!allowedStatuses.has(status)) {
    throw new Error(`${obligationId} has invalid status ${status}`);
  }
  if (
    status === "verified" &&
    (evidenceLinks.length === 0 ||
      !/^[0-9a-f]{7,40}$/i.test(commit ?? "") ||
      !verifiedAt ||
      Number.isNaN(Date.parse(verifiedAt)))
  ) {
    throw new Error(
      `${obligationId} verified status requires evidence, commit, and date`,
    );
  }
  if (
    ["failed", "deferred_external"].includes(status) &&
    (evidenceLinks.length === 0 ||
      !verifiedAt ||
      Number.isNaN(Date.parse(verifiedAt)))
  ) {
    throw new Error(
      `${obligationId} ${status} requires evidence and a dated decision`,
    );
  }
  return {
    obligationId,
    obligationDefinitionHash: definitionHash,
    ...obligation,
    status,
    evidence: evidenceLinks,
    commit,
    verifiedAt,
  };
};

const computeParentStatus = (obligations) => {
  const statuses = obligations.map((item) => item.status);
  if (statuses.includes("failed")) return "failed";
  if (statuses.every((status) => status === "superseded")) return "superseded";
  if (statuses.every((status) => status === "verified")) return "verified";
  if (
    statuses.every((status) =>
      ["verified", "deferred_external"].includes(status),
    ) &&
    statuses.includes("deferred_external")
  ) {
    return "deferred_external";
  }
  if (statuses.includes("implemented_unverified")) {
    return "implemented_unverified";
  }
  return "unimplemented";
};

const requirements = requirementPlans.map((item) => {
  const source = sourceFor(item.id);
  const obligations = item.obligations.map((obligation) =>
    materializeObligation(item.id, obligation, {
      ...source,
      designContract: item.designContract,
    }),
  );
  return {
    id: item.id,
    ...source,
    designContract: item.designContract,
    obligations,
    parentStatus: computeParentStatus(obligations),
    parentStatusRule:
      "verified only when every required obligation is verified; failed dominates; deferred_external is milestone-scoped",
  };
});

const unknownEvidenceKeys = Object.keys(evidenceEntries).filter(
  (key) => !expectedEvidenceKeys.has(key),
);
if (unknownEvidenceKeys.length > 0) {
  throw new Error(
    `Unknown or stale traceability evidence keys: ${unknownEvidenceKeys.join(",")}`,
  );
}

const verificationIds = new Set(
  [
    ...verificationContract.matchAll(
      /^\|\s*`(V-(?:P[0-4]|D)-\d{3})`\s*\|/gm,
    ),
  ].map((match) => match[1]),
);
for (const requirement of requirements) {
  for (const obligation of requirement.obligations) {
    if (
      /V-(?:P[0-4]|D)-\d{3}\s*(?:\.\.|[–-])\s*(?:V-(?:P[0-4]|D)-)?\d{3}/.test(
        obligation.automatedProof,
      )
    ) {
      throw new Error(
        `${obligation.obligationId} uses a compact verification-ID range`,
      );
    }
    const referencedVerificationIds = [
      ...obligation.automatedProof.matchAll(
        /V-(?:P[0-4]|D)-\d{3}/g,
      ),
    ].map((match) => match[0]);
    for (const verificationId of referencedVerificationIds) {
      if (!verificationIds.has(verificationId)) {
        throw new Error(
          `${obligation.obligationId} references unknown ${verificationId}`,
        );
      }
      const checkpoint = verificationId.startsWith("V-D-")
        ? "deployment"
        : `phase${verificationId.slice(3, 4)}`;
      if (checkpoint !== obligation.checkpoint) {
        throw new Error(
          `${obligation.obligationId} references future/wrong-checkpoint ${verificationId}`,
        );
      }
    }
  }
}

const counts = {
  product: requirements.filter((item) => item.id.startsWith("GEN-PROD-"))
    .length,
  qc: requirements.filter((item) => item.id.startsWith("AC-QC-")).length,
  threat: requirements.filter((item) => item.id.startsWith("TM-")).length,
  normativeQc: requirements.filter(
    (item) => item.id.startsWith("GQC-") || item.id.startsWith("CAL-"),
  ).length,
};
if (
  counts.product !== 25 ||
  counts.qc !== 40 ||
  counts.threat !== 42 ||
  counts.normativeQc !== 100
) {
  throw new Error(`Unexpected traceability counts: ${JSON.stringify(counts)}`);
}
if (
  requirements.some(
    (item) =>
      !item.rationale ||
      item.obligations.length === 0 ||
      item.obligations.some(
        (obligation) =>
          obligation.workPackages.length === 0 ||
          obligation.workPackages.some((task) => !taskIdSet.has(task)) ||
          obligation.workPackages.some(
            (task) => checkpointForTask(task) !== obligation.checkpoint,
          ),
      ),
  )
) {
  throw new Error("Every requirement needs valid phase-correct obligations");
}

const output = {
  schemaVersion: "traceability-plan.v1",
  generatedDate: "2026-07-17",
  evidenceSource:
    "reference/acceptance/traceability-evidence.v1.json",
  statusVocabulary,
  gateRule:
    "A phase gates only its own obligation. A parent is verified only after every required obligation is verified.",
  counts,
  requirements,
};

const destination = path.join(
  root,
  "reference",
  "acceptance",
  "traceability-plan.v1.json",
);
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(destination);
