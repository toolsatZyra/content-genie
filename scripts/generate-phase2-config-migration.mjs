import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifestPath = path.join(root, "src", "domain", "look", "look-pack.v1.json");
const templatePath = path.join(
  root,
  "supabase",
  "templates",
  "phase2_0011_looks_voices_and_config.sql.template",
);
const schemaOutputPath = path.join(
  root,
  "supabase",
  "migrations",
  "20260717121600_phase2_looks_voices_and_config.sql",
);
const checkOnly = process.argv.includes("--check");

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};
const emit = (outputPath, contents) => {
  if (!checkOnly) {
    fs.writeFileSync(outputPath, contents, "utf8");
    return;
  }
  if (!fs.existsSync(outputPath)) {
    throw new Error(
      `Generated artifact is missing: ${path.relative(root, outputPath)}`,
    );
  }
  const actual = fs.readFileSync(outputPath, "utf8");
  if (actual !== contents) {
    throw new Error(`Generated artifact is stale: ${path.relative(root, outputPath)}`);
  }
};

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const manifestSha256 = sha256(fs.readFileSync(manifestPath));
const manifestEntryHash = (look) =>
  sha256(
    JSON.stringify({
      ...look,
      packId: manifest.packId,
      packVersion: manifest.packVersion,
    }),
  );
if (manifest.schemaVersion !== "genie-look-pack.v1" || manifest.looks.length !== 117) {
  throw new Error("The look pack is not the reviewed 117-look v1 manifest.");
}
const sharedProvenance = manifest.looks[0]?.provenance;
if (
  !sharedProvenance ||
  !manifest.importedFrom?.repositoryUrl ||
  !manifest.importedFrom?.sourceCommit ||
  !manifest.importedFrom?.catalogSha256 ||
  manifest.looks.some(
    ({ provenance }) =>
      provenance.sourceCommit !== manifest.importedFrom.sourceCommit ||
      provenance.sourceCatalogSha256 !== manifest.importedFrom.catalogSha256 ||
      provenance.internalRightsBasis !== sharedProvenance.internalRightsBasis ||
      provenance.creativeReview !== sharedProvenance.creativeReview ||
      provenance.reviewedAt !== sharedProvenance.reviewedAt,
  )
) {
  throw new Error("The look pack has inconsistent shared source provenance.");
}
if (
  manifest.looks.some(
    (look) =>
      look.negativePolicy?.schemaVersion !== "genie-look-negative-policy.v1" ||
      look.visualQcBaseline?.schemaVersion !== "genie-look-visual-qc-baseline.v1" ||
      look.negativePolicy.sha256 !==
        sha256(
          canonical({
            promptTail: look.negativePolicy.promptTail,
            rules: look.negativePolicy.rules,
            schemaVersion: look.negativePolicy.schemaVersion,
          }),
        ) ||
      look.visualQcBaseline.sha256 !==
        sha256(
          canonical({
            checks: look.visualQcBaseline.checks,
            negativePolicySha256: look.visualQcBaseline.negativePolicySha256,
            schemaVersion: look.visualQcBaseline.schemaVersion,
            semantics: look.visualQcBaseline.semantics,
            sourceLookBlockSha256: look.visualQcBaseline.sourceLookBlockSha256,
          }),
        ) ||
      look.visualQcBaseline.sourceLookBlockSha256 !== look.lockedLookBlockSha256 ||
      look.visualQcBaseline.negativePolicySha256 !== look.negativePolicy.sha256,
  )
) {
  throw new Error("The look pack has invalid structured policy bindings.");
}

const rows = manifest.looks.map((look) => {
  const modes = `array[${look.modes.map(quote).join(",")}]::text[]`;
  return `  (${[
    quote(look.versionId),
    quote(look.id),
    quote(manifest.packId),
    manifest.packVersion,
    quote(look.name),
    quote(look.family),
    quote(look.feel),
    modes,
    quote(look.lockedLookBlockSha256),
    `${quote(JSON.stringify(look.negativePolicy))}::jsonb`,
    quote(look.negativePolicy.sha256),
    `${quote(JSON.stringify(look.visualQcBaseline))}::jsonb`,
    quote(look.visualQcBaseline.sha256),
    quote(look.preview.path),
    quote(look.preview.sha256),
    look.preview.width,
    look.preview.height,
    quote(look.provenance.sourcePromptSha256),
    quote(look.provenance.sourceRecordSha256),
    quote(manifestEntryHash(look)),
  ].join(", ")})`;
});

const replacements = new Map([
  ["__LOOK_PACK_MANIFEST_SHA256__", manifestSha256],
  ["__LOOK_PACK_SOURCE_REPOSITORY__", manifest.importedFrom.repositoryUrl],
  ["__LOOK_PACK_SOURCE_COMMIT__", manifest.importedFrom.sourceCommit],
  ["__LOOK_PACK_SOURCE_CATALOG_SHA256__", manifest.importedFrom.catalogSha256],
  ["__LOOK_PACK_RIGHTS_BASIS__", sharedProvenance.internalRightsBasis],
  ["__LOOK_PACK_CREATIVE_REVIEW__", sharedProvenance.creativeReview],
  ["__LOOK_PACK_REVIEWED_AT__", sharedProvenance.reviewedAt],
]);
let template = fs.readFileSync(templatePath, "utf8");
for (const [placeholder, value] of replacements) {
  template = template.replaceAll(placeholder, String(value).replaceAll("'", "''"));
}
if (template.includes("__LOOK_VERSION_ROWS__")) {
  throw new Error("The Phase 2 config schema template still contains seed data.");
}
emit(schemaOutputPath, template);

const correctionOutputPath = path.join(
  root,
  "supabase",
  "migrations",
  "20260717121605_phase2_0011_look_pack_provenance_correction.sql",
);
emit(
  correctionOutputPath,
  `-- Phase 2 / 0011 forward correction: reconcile persisted look-pack provenance
-- with the immutable source manifest. Safe as a no-op on fresh databases.
-- Migration-owner trigger suspension is transaction-scoped by the migration runner.

alter table public.look_packs disable trigger look_packs_immutable;

update public.look_packs
set source_repository = ${quote(manifest.importedFrom.repositoryUrl)},
    source_commit = ${quote(manifest.importedFrom.sourceCommit)},
    source_catalog_sha256 = ${quote(manifest.importedFrom.catalogSha256)},
    internal_rights_basis = ${quote(sharedProvenance.internalRightsBasis)},
    creative_review = ${quote(sharedProvenance.creativeReview)},
    reviewed_at = ${quote(sharedProvenance.reviewedAt)}::date
where id = ${quote(manifest.packId)}
  and pack_version = ${manifest.packVersion};

alter table public.look_packs enable trigger look_packs_immutable;

do $provenance$
begin
  if not exists (
    select 1
    from public.look_packs
    where id = ${quote(manifest.packId)}
      and pack_version = ${manifest.packVersion}
      and source_repository = ${quote(manifest.importedFrom.repositoryUrl)}
      and source_commit = ${quote(manifest.importedFrom.sourceCommit)}
      and source_catalog_sha256 = ${quote(manifest.importedFrom.catalogSha256)}
  ) then
    raise exception 'look-pack provenance correction failed';
  end if;
end
$provenance$;
`,
);

const policyBindingOutputPath = path.join(
  root,
  "supabase",
  "migrations",
  "20260717121608_phase2_look_policy_baselines.sql",
);
const policyUpdates = manifest.looks
  .map(
    (look) => `update public.look_versions
set look_key = ${quote(look.id)},
    pack_id = ${quote(manifest.packId)},
    pack_version = ${manifest.packVersion},
    name = ${quote(look.name)},
    family = ${quote(look.family)},
    feel = ${quote(look.feel)},
    modes = array[${look.modes.map(quote).join(",")}]::text[],
    locked_look_block_sha256 = ${quote(look.lockedLookBlockSha256)},
    negative_policy = ${quote(JSON.stringify(look.negativePolicy))}::jsonb,
    negative_policy_sha256 = ${quote(look.negativePolicy.sha256)},
    visual_qc_baseline = ${quote(JSON.stringify(look.visualQcBaseline))}::jsonb,
    visual_qc_baseline_sha256 = ${quote(look.visualQcBaseline.sha256)},
    preview_path = ${quote(look.preview.path)},
    preview_sha256 = ${quote(look.preview.sha256)},
    preview_width = ${look.preview.width},
    preview_height = ${look.preview.height},
    source_prompt_sha256 = ${quote(look.provenance.sourcePromptSha256)},
    source_record_sha256 = ${quote(look.provenance.sourceRecordSha256)},
    manifest_entry_hash = ${quote(manifestEntryHash(look))}
where id = ${quote(look.versionId)};`,
  )
  .join("\n\n");
emit(
  policyBindingOutputPath,
  `-- Phase 2 / 0011 forward correction: reconcile each prelaunch look version
-- to the reviewed immutable manifest and bind its negative/QC policy.

alter table public.look_versions
  add column if not exists negative_policy jsonb,
  add column if not exists negative_policy_sha256 text,
  add column if not exists visual_qc_baseline jsonb,
  add column if not exists visual_qc_baseline_sha256 text;

alter table public.look_versions disable trigger look_versions_immutable;

${policyUpdates}

alter table public.look_versions enable trigger look_versions_immutable;

alter table public.look_versions
  alter column negative_policy set not null,
  alter column negative_policy_sha256 set not null,
  alter column visual_qc_baseline set not null,
  alter column visual_qc_baseline_sha256 set not null,
  drop constraint if exists look_versions_negative_policy_shape,
  add constraint look_versions_negative_policy_shape check (
    jsonb_typeof(negative_policy) = 'object'
    and negative_policy ->> 'schemaVersion' = 'genie-look-negative-policy.v1'
    and negative_policy_sha256 ~ '^[a-f0-9]{64}$'
  ),
  drop constraint if exists look_versions_visual_qc_shape,
  add constraint look_versions_visual_qc_shape check (
    jsonb_typeof(visual_qc_baseline) = 'object'
    and visual_qc_baseline ->> 'schemaVersion' = 'genie-look-visual-qc-baseline.v1'
    and visual_qc_baseline ->> 'sourceLookBlockSha256' = locked_look_block_sha256
    and visual_qc_baseline ->> 'negativePolicySha256' = negative_policy_sha256
    and visual_qc_baseline_sha256 ~ '^[a-f0-9]{64}$'
  );

alter table public.look_packs disable trigger look_packs_immutable;
update public.look_packs
set manifest_sha256 = ${quote(manifestSha256)}
where id = ${quote(manifest.packId)} and pack_version = ${manifest.packVersion};
alter table public.look_packs enable trigger look_packs_immutable;
`,
);

const voiceFunctionStart = template.indexOf(
  "create or replace function public.command_set_voice_version_availability(",
);
const voiceFunctionEnd = template.indexOf(
  "create or replace function public.command_withdraw_look_version(",
  voiceFunctionStart,
);
if (voiceFunctionStart < 0 || voiceFunctionEnd < 0) {
  throw new Error("The rendered voice availability function is missing.");
}
const voiceFunction = template.slice(voiceFunctionStart, voiceFunctionEnd);
const voiceFailClosedOutputPath = path.join(
  root,
  "supabase",
  "migrations",
  "20260717121606_phase2_voice_canary_fail_closed.sql",
);
emit(
  voiceFailClosedOutputPath,
  `-- Phase 2 / 0011 forward correction: a caller-authored object is not
-- provider authentication. Keep both launch voices pending until an authenticated
-- ElevenLabs receipt verifier is implemented.

alter table private.voice_version_availability_events
  drop constraint if exists voice_availability_events_no_unattested_verification;
alter table private.voice_version_availability_events
  add constraint voice_availability_events_no_unattested_verification
  check (new_status <> 'verified');

${voiceFunction}revoke all on function public.command_set_voice_version_availability(
  uuid,bigint,public.voice_version_availability_status,jsonb,uuid,text,text,uuid
) from public, anon, authenticated;
grant execute on function public.command_set_voice_version_availability(
  uuid,bigint,public.voice_version_availability_status,jsonb,uuid,text,text,uuid
) to service_role;

revoke all on function public.command_withdraw_voice_version(
  uuid,bigint,jsonb,uuid,text,text,uuid
) from public, anon, authenticated;
grant execute on function public.command_withdraw_voice_version(
  uuid,bigint,jsonb,uuid,text,text,uuid
) to service_role;
`,
);

const columns = `insert into public.look_versions (
  id,
  look_key,
  pack_id,
  pack_version,
  name,
  family,
  feel,
  modes,
  locked_look_block_sha256,
  negative_policy,
  negative_policy_sha256,
  visual_qc_baseline,
  visual_qc_baseline_sha256,
  preview_path,
  preview_sha256,
  preview_width,
  preview_height,
  source_prompt_sha256,
  source_record_sha256,
  manifest_entry_hash
)
values
`;
const batchSize = 30;
const expectedSeedPaths = [];
for (let offset = 0; offset < rows.length; offset += batchSize) {
  const batch = rows.slice(offset, offset + batchSize);
  const batchNumber = Math.floor(offset / batchSize) + 1;
  const timestamp = 20260717121600 + batchNumber;
  const seedPath = path.join(
    root,
    "supabase",
    "migrations",
    `${timestamp}_phase2_0011_look_seed_${String(batchNumber).padStart(2, "0")}.sql`,
  );
  expectedSeedPaths.push(seedPath);
  emit(
    seedPath,
    `-- Phase 2 / 0011 seed ${batchNumber}: pinned look versions ${
      offset + 1
    }-${offset + batch.length} of ${rows.length}.\n\n${columns}${batch.join(",\n")};\n`,
  );
}

const actualSeedPaths = fs
  .readdirSync(path.dirname(schemaOutputPath))
  .filter((filename) =>
    /^2026071712160\d_phase2_0011_look_seed_\d{2}\.sql$/.test(filename),
  )
  .map((filename) => path.join(path.dirname(schemaOutputPath), filename))
  .sort();
if (
  actualSeedPaths.length !== expectedSeedPaths.length ||
  actualSeedPaths.some((seedPath, index) => seedPath !== expectedSeedPaths[index])
) {
  throw new Error("The checked-in Phase 2 look seed migration set is stale.");
}

console.log(
  `${checkOnly ? "Verified" : "Generated"} ${path.relative(
    root,
    schemaOutputPath,
  )} plus 4 pinned look seed migrations`,
);
