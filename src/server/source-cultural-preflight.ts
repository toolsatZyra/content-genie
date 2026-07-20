import "server-only";

import { createHash } from "node:crypto";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { postgresJsonbText } from "@/server/world-anchor-provider";

export class SourceCulturalPreflightError extends Error {
  override readonly name = "SourceCulturalPreflightError";

  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

type PolicyRule = Readonly<{
  code: string;
  contentClass: string;
  defaultVerdict: string;
  id: string;
  nonOverridable: boolean;
  ruleText: string;
}>;

type CharacterInput = Readonly<{
  characterVersionId: string;
  canonicalKey: string;
  displayName: string;
  formKey: string;
  identityManifest: Readonly<Record<string, unknown>>;
}>;

type TempleReference = Readonly<{
  assetVersionId: string;
  authorCredit: string;
  canonicalTitle: string;
  licenseShortName: string;
  licenseUrl: string;
  sourceFileUrl: string;
  sourceMetadataHash: string;
  sourcePageUrl: string;
}>;

type LocationInput = Readonly<{
  canonicalKey: string;
  displayName: string;
  locationVersionId: string;
  namedTemple: boolean;
  realPlaceName: string | null;
  templeReferences: readonly TempleReference[];
}>;

type SourceCulturalInput = Readonly<{
  characters: readonly CharacterInput[];
  configurationCandidateId: string;
  existingPacketId: string | null;
  locations: readonly LocationInput[];
  policyHash: string;
  policyRules: readonly PolicyRule[];
  policyVersionId: string;
  processingText: string;
  rawScriptSha256: string;
  seriesId: string;
  seriesTitle: string;
  subjectHash: string;
  worldExtraction: Readonly<Record<string, unknown>>;
  worldExtractionResultId: string;
  worldReferencePackVersionId: string;
}>;

type CatalogSource = Readonly<{
  editionCitation: string;
  key: string;
  proposition: string;
  rightsBasis?: string;
  rightsStatus?: "factual_reference_only" | "internal_authorized" | "licensed";
  sourceClass:
    | "popular_retelling"
    | "primary_text"
    | "regional_retelling"
    | "rights_cleared_photography";
  title: string;
  url: string | null;
}>;

type RecordedSource = Readonly<{
  sourceVersionId: string;
  source: CatalogSource;
}>;

type SourceLink = Readonly<{
  claimClass:
    | "costume_social"
    | "deity_form"
    | "narrative"
    | "relationship"
    | "rights"
    | "sensitive_depiction"
    | "temple";
  evidenceRole: string;
  sourceRecordVersionId: string;
  subjectId: string;
  subjectKind: "character_version" | "location_version" | "none";
}>;

const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

function deterministicUuid(seed: string): string {
  const bytes = Buffer.from(sha256(seed).slice(0, 32), "hex");
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SourceCulturalPreflightError(`${label} is malformed.`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string, maximum = 8_000): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    throw new SourceCulturalPreflightError(`${label} is malformed.`);
  }
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : string(value, label, 2_048);
}

function array(value: unknown, label: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new SourceCulturalPreflightError(`${label} is malformed.`);
  }
  return value;
}

function parseInput(value: unknown): SourceCulturalInput {
  const row = object(value, "Source cultural input");
  const worldExtraction = object(row.worldExtraction, "World extraction");
  const characters = array(row.characters, "Characters", 96).map((entry, index) => {
    const item = object(entry, `Character ${index + 1}`);
    return Object.freeze({
      canonicalKey: string(item.canonicalKey, "Character key", 100),
      characterVersionId: string(item.characterVersionId, "Character version", 36),
      displayName: string(item.displayName, "Character name", 200),
      formKey: string(item.formKey, "Character form", 100),
      identityManifest: object(item.identityManifest, "Identity manifest"),
    });
  });
  const locations = array(row.locations, "Locations", 12).map((entry, index) => {
    const item = object(entry, `Location ${index + 1}`);
    const references = array(item.templeReferences, "Temple references", 4).map(
      (reference, referenceIndex) => {
        const source = object(reference, `Temple reference ${referenceIndex + 1}`);
        return Object.freeze({
          assetVersionId: string(source.assetVersionId, "Reference asset", 36),
          authorCredit: string(source.authorCredit, "Reference author", 1_000),
          canonicalTitle: string(source.canonicalTitle, "Reference title", 500),
          licenseShortName: string(source.licenseShortName, "Reference licence", 100),
          licenseUrl: string(source.licenseUrl, "Reference licence URL", 2_048),
          sourceFileUrl: string(source.sourceFileUrl, "Reference file URL", 2_048),
          sourceMetadataHash: string(
            source.sourceMetadataHash,
            "Reference evidence",
            64,
          ),
          sourcePageUrl: string(source.sourcePageUrl, "Reference page URL", 2_048),
        });
      },
    );
    return Object.freeze({
      canonicalKey: string(item.canonicalKey, "Location key", 100),
      displayName: string(item.displayName, "Location name", 240),
      locationVersionId: string(item.locationVersionId, "Location version", 36),
      namedTemple: item.namedTemple === true,
      realPlaceName: nullableString(item.realPlaceName, "Real place name"),
      templeReferences: Object.freeze(references),
    });
  });
  const policyRules = array(row.policyRules, "Policy rules", 100).map(
    (entry, index) => {
      const item = object(entry, `Policy rule ${index + 1}`);
      return Object.freeze({
        code: string(item.code, "Policy rule code", 100),
        contentClass: string(item.contentClass, "Policy content class", 100),
        defaultVerdict: string(item.defaultVerdict, "Policy default verdict", 100),
        id: string(item.id, "Policy rule ID", 36),
        nonOverridable: item.nonOverridable === true,
        ruleText: string(item.ruleText, "Policy rule text", 2_000),
      });
    },
  );
  if (characters.length < 1 || locations.length < 1 || policyRules.length < 1) {
    throw new SourceCulturalPreflightError("Source cultural input is incomplete.");
  }
  return Object.freeze({
    characters: Object.freeze(characters),
    configurationCandidateId: string(
      row.configurationCandidateId,
      "Configuration candidate",
      36,
    ),
    existingPacketId:
      row.existingPacketId === null
        ? null
        : string(row.existingPacketId, "Existing packet", 36),
    locations: Object.freeze(locations),
    policyHash: string(row.policyHash, "Policy hash", 64),
    policyRules: Object.freeze(policyRules),
    policyVersionId: string(row.policyVersionId, "Policy version", 36),
    processingText: string(row.processingText, "Processing text", 90_000),
    rawScriptSha256: string(row.rawScriptSha256, "Script hash", 64),
    seriesId: string(row.seriesId, "Series", 36),
    seriesTitle: string(row.seriesTitle, "Series title", 300),
    subjectHash: string(row.subjectHash, "Subject hash", 64),
    worldExtraction,
    worldExtractionResultId: string(
      row.worldExtractionResultId,
      "World extraction result",
      36,
    ),
    worldReferencePackVersionId: string(
      row.worldReferencePackVersionId,
      "World reference pack",
      36,
    ),
  });
}

const catalog = Object.freeze({
  gita: Object.freeze({
    editionCitation:
      "Project Gutenberg ebook 2388; public-domain English translation locator.",
    key: "bhagavad-gita.pg2388",
    proposition:
      "Primary-text locator for Bhagavad Gita narrative context, Sanskrit names, and verse attribution; applicability remains a qualified human decision.",
    sourceClass: "primary_text" as const,
    title: "The Bhagavad Gita",
    url: "https://www.gutenberg.org/ebooks/2388",
  }),
  mahabharata: Object.freeze({
    editionCitation: "Kisari Mohan Ganguli translation, Project Gutenberg ebook 15474.",
    key: "mahabharata.pg15474",
    proposition:
      "Primary-epic locator for Mahabharata characters and narrative relationships; exact passage applicability remains a qualified human decision.",
    sourceClass: "primary_text" as const,
    title: "The Mahabharata of Krishna-Dwaipayana Vyasa",
    url: "https://www.gutenberg.org/ebooks/15474",
  }),
  ramayana: Object.freeze({
    editionCitation: "Ralph T. H. Griffith translation, Project Gutenberg ebook 24869.",
    key: "ramayana.pg24869",
    proposition:
      "Primary-epic locator for Ramayana characters and narrative relationships; exact passage applicability remains a qualified human decision.",
    sourceClass: "primary_text" as const,
    title: "The Ramayan of Valmiki",
    url: "https://www.gutenberg.org/ebooks/24869",
  }),
  devi: Object.freeze({
    editionCitation:
      "Wikisource text locator for Devi Mahatmyam regional and translation review.",
    key: "devi-mahatmyam.wikisource",
    proposition:
      "Text locator for Devi, Durga, and Kali form and narrative review; exact form, attribute, and regional interpretation remain qualified human decisions.",
    sourceClass: "primary_text" as const,
    title: "Devi Mahatmyam",
    url: "https://en.wikisource.org/wiki/Dev%C4%AB_M%C4%81h%C4%81tmyam",
  }),
  shiva: Object.freeze({
    editionCitation:
      "Wikisource and public-reference locator for Shiva Purana traditions.",
    key: "shiva-purana.reference",
    proposition:
      "Source locator for Shaiva forms and attributes; exact Purana passage and regional interpretation remain qualified human decisions.",
    sourceClass: "popular_retelling" as const,
    title: "Shiva Purana source locator",
    url: "https://en.wikipedia.org/wiki/Shiva_Purana",
  }),
  vishnu: Object.freeze({
    editionCitation:
      "Wikisource public-reference locator for Vishnu Purana traditions.",
    key: "vishnu-purana.reference",
    proposition:
      "Source locator for Vaishnava forms and attributes; exact Purana passage and regional interpretation remain qualified human decisions.",
    sourceClass: "popular_retelling" as const,
    title: "Vishnu Purana source locator",
    url: "https://en.wikisource.org/wiki/The_Vishnu_Purana",
  }),
  general: Object.freeze({
    editionCitation:
      "Wikimedia public-reference locator; never treated as sole theological authority.",
    key: "hindu-deities.reference",
    proposition:
      "Secondary locator for a named Hindu form; it is included for reviewer navigation and never substitutes for qualified cultural judgment.",
    sourceClass: "popular_retelling" as const,
    title: "Hindu deity reference locator",
    url: "https://en.wikipedia.org/wiki/Hindu_deities",
  }),
});

export function chooseCulturalCatalogSource(
  canonicalKey: string,
  displayName: string,
  processingText: string,
): CatalogSource {
  const select = (value: string): CatalogSource | null => {
    const haystack = value.normalize("NFKC").toLowerCase();
    if (
      /\b(rama|ram|sita|hanuman|ravana|lakshmana|ramayana)\b|राम|सीता|हनुमान|रावण|लक्ष्मण/u.test(
        haystack,
      )
    )
      return catalog.ramayana;
    if (
      /\b(krishna|arjuna|pandava|kaurava|mahabharata)\b|कृष्ण|अर्जुन|पांडव|कौरव|महाभारत/u.test(
        haystack,
      )
    )
      return catalog.mahabharata;
    if (/\b(gita|geeta)\b|गीता/u.test(haystack)) return catalog.gita;
    if (/\b(durga|kali|kaali|devi|chandi)\b|दुर्गा|काली|देवी|चंडी/u.test(haystack))
      return catalog.devi;
    if (/\b(shiva|shiv|mahadev|parvati)\b|शिव|महादेव|पार्वती/u.test(haystack))
      return catalog.shiva;
    if (/\b(vishnu|narayana|lakshmi)\b|विष्णु|नारायण|लक्ष्मी/u.test(haystack))
      return catalog.vishnu;
    return null;
  };
  return (
    select(`${canonicalKey} ${displayName}`) ??
    select(processingText) ??
    catalog.general
  );
}

function worldContext(input: SourceCulturalInput): {
  interpretationLabels: string[];
  region: string;
  tradition: string;
} {
  const story = object(input.worldExtraction.storyContext, "Story context");
  const tradition = string(story.primaryTradition, "Primary tradition", 100);
  const region =
    story.regionalContext === null
      ? "pan-indian"
      : string(story.regionalContext, "Regional context", 100);
  const era = string(story.era, "Story era", 300);
  return {
    interpretationLabels: [tradition, region, era]
      .map((entry) =>
        entry
          .normalize("NFKD")
          .replace(/[\u0300-\u036f]/gu, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/gu, "-")
          .replace(/^-|-$/gu, "")
          .slice(0, 80),
      )
      .filter(
        (entry, index, values) => entry.length > 0 && values.indexOf(entry) === index,
      ),
    region,
    tradition,
  };
}

function sourceStableKey(prefix: string, sourceKey: string): string {
  const normalized = `${prefix}.${sourceKey}`
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/gu, "-")
    .replace(/^[^a-z0-9]+/u, "");
  if (normalized.length < 3) return `source.${sha256(sourceKey).slice(0, 20)}`;
  if (normalized.length <= 119) return normalized;
  return `${normalized.slice(0, 110)}-${sha256(normalized).slice(0, 8)}`;
}

async function recordSource(input: {
  seriesId: string;
  source: CatalogSource;
  stableKey: string;
  workspaceId: string;
}): Promise<RecordedSource> {
  const client = createAdminSupabaseClient();
  const sourceRecordId = deterministicUuid(
    `source-record:${input.workspaceId}:${input.seriesId}:${input.stableKey}`,
  );
  const evidence = {
    catalogKey: input.source.key,
    editionCitation: input.source.editionCitation,
    proposition: input.source.proposition,
    schemaVersion: "genie.curated-source-catalog-evidence.v1",
    stableUrl: input.source.url,
    title: input.source.title,
  };
  const evidenceHash = sha256(postgresJsonbText(evidence));
  const canonical = {
    ...evidence,
    rightsBasis:
      input.source.rightsBasis ??
      (input.source.url === null
        ? "Author-supplied internal narration; Zyra records internal production authorization."
        : "Factual and textual reference only; no source page media or expressive text is copied into the film."),
    rightsStatus:
      input.source.rightsStatus ??
      (input.source.url === null ? "internal_authorized" : "factual_reference_only"),
  };
  const canonicalHash = sha256(postgresJsonbText(canonical));
  const sourceVersionId = deterministicUuid(
    `source-version:${sourceRecordId}:${canonicalHash}`,
  );
  const existing = await client
    .from("source_record_versions")
    .select("id")
    .eq("id", sourceVersionId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (existing.error) {
    throw new SourceCulturalPreflightError("Source registry lookup failed.", true);
  }
  if (!existing.data) {
    const { error } = await client.rpc("command_record_source_version", {
      p_archive_handle: null,
      p_bounded_proposition: input.source.proposition,
      p_canonical_hash: canonicalHash,
      p_contradiction_state: "none",
      p_creator_principal: "genie-curated-source-catalog.v1",
      p_edition_citation: input.source.editionCitation,
      p_evidence_sha256: evidenceHash,
      p_language: "Hindi/Sanskrit/English",
      p_rights_basis: canonical.rightsBasis,
      p_rights_status: canonical.rightsStatus,
      p_series_id: input.seriesId,
      p_source_class: input.source.sourceClass,
      p_source_record_id: sourceRecordId,
      p_source_version_id: sourceVersionId,
      p_stable_key: input.stableKey,
      p_stable_url: input.source.url,
      p_title: input.source.title,
      p_verification_state: "verified",
      p_workspace_id: input.workspaceId,
    });
    if (error) {
      throw new SourceCulturalPreflightError("Source registry rejected evidence.");
    }
  }
  return Object.freeze({ source: input.source, sourceVersionId });
}

function scriptSource(input: SourceCulturalInput): CatalogSource {
  return Object.freeze({
    editionCitation: `Exact locked narration SHA-256 ${input.rawScriptSha256}.`,
    key: `author-script.${input.rawScriptSha256.slice(0, 16)}`,
    proposition:
      "The exact author-supplied narration is the sole narrative wording authority; it may be annotated for production but never rewritten in script-to-video mode.",
    sourceClass: "regional_retelling",
    title: `${input.seriesTitle} — author-supplied locked narration`,
    url: null,
  });
}

function templeSource(
  reference: TempleReference,
  location: LocationInput,
): CatalogSource {
  return Object.freeze({
    editionCitation: `${reference.authorCredit}; ${reference.licenseShortName}; ${reference.licenseUrl}`,
    key: `temple-photo.${reference.sourceMetadataHash.slice(0, 20)}`,
    proposition: `Rights-cleared photographic reference for the visible architecture and geometry of ${location.realPlaceName ?? location.displayName}; not a narrative or ritual authority.`,
    rightsBasis: `${reference.licenseShortName}; ${reference.licenseUrl}; attribution ${reference.authorCredit}.`,
    rightsStatus: "licensed",
    sourceClass: "rights_cleared_photography",
    title: reference.canonicalTitle,
    url: reference.sourcePageUrl,
  });
}

function isDeity(character: CharacterInput): boolean {
  return character.identityManifest.isDeity === true;
}

export function buildQualifiedReviewFindings(
  rules: readonly PolicyRule[],
  subjectHash: string,
): readonly Readonly<Record<string, unknown>>[] {
  return Object.freeze(
    rules.map((rule) =>
      Object.freeze({
        confidence: 1,
        evidenceHash: sha256(
          postgresJsonbText({
            ruleCode: rule.code,
            schemaVersion: "genie.cultural-human-gate-evidence.v1",
            subjectHash,
          }),
        ),
        policyRuleId: rule.id,
        safeSummary: `${rule.ruleText} Monica requires the appointed reviewer to confirm this against the exact locked script, selected World, and cited sources.`,
        subjectId: "",
        subjectKind: "general",
        verdict: "qualified_review_required",
      }),
    ),
  );
}

async function sourceInput(
  workspaceId: string,
  configurationCandidateId: string,
  worldReferencePackVersionId: string,
): Promise<SourceCulturalInput> {
  const { data, error } = await createAdminSupabaseClient().rpc(
    "get_source_cultural_preflight_input",
    {
      p_configuration_candidate_id: configurationCandidateId,
      p_workspace_id: workspaceId,
      p_world_reference_pack_version_id: worldReferencePackVersionId,
    },
  );
  if (error || !data) {
    throw new SourceCulturalPreflightError(
      "The accepted World is not ready for cultural review.",
      true,
    );
  }
  return parseInput(data);
}

export async function ensureSourceCulturalPacket(input: {
  configurationCandidateId: string;
  workspaceId: string;
  worldReferencePackVersionId: string;
}): Promise<
  Readonly<{ packetId: string; replayed: boolean; scriptSourceVersionId: string }>
> {
  const preparation = await sourceInput(
    input.workspaceId,
    input.configurationCandidateId,
    input.worldReferencePackVersionId,
  );
  const authorSource = await recordSource({
    seriesId: preparation.seriesId,
    source: scriptSource(preparation),
    stableKey: sourceStableKey("author", preparation.rawScriptSha256.slice(0, 32)),
    workspaceId: input.workspaceId,
  });
  if (preparation.existingPacketId) {
    return Object.freeze({
      packetId: preparation.existingPacketId,
      replayed: true,
      scriptSourceVersionId: authorSource.sourceVersionId,
    });
  }

  const links: SourceLink[] = [
    {
      claimClass: "narrative",
      evidenceRole: "",
      sourceRecordVersionId: authorSource.sourceVersionId,
      subjectId: "",
      subjectKind: "none",
    },
    {
      claimClass: "relationship",
      evidenceRole: "",
      sourceRecordVersionId: authorSource.sourceVersionId,
      subjectId: "",
      subjectKind: "none",
    },
    {
      claimClass: "costume_social",
      evidenceRole: "",
      sourceRecordVersionId: authorSource.sourceVersionId,
      subjectId: "",
      subjectKind: "none",
    },
    {
      claimClass: "sensitive_depiction",
      evidenceRole: "",
      sourceRecordVersionId: authorSource.sourceVersionId,
      subjectId: "",
      subjectKind: "none",
    },
  ];

  for (const character of preparation.characters.filter(isDeity)) {
    const source = chooseCulturalCatalogSource(
      character.canonicalKey,
      character.displayName,
      preparation.processingText,
    );
    const recorded = await recordSource({
      seriesId: preparation.seriesId,
      source,
      stableKey: sourceStableKey(
        `deity.${character.canonicalKey}.${character.formKey}`,
        source.key,
      ),
      workspaceId: input.workspaceId,
    });
    links.push({
      claimClass: "deity_form",
      evidenceRole: "form",
      sourceRecordVersionId: recorded.sourceVersionId,
      subjectId: character.characterVersionId,
      subjectKind: "character_version",
    });
  }

  for (const location of preparation.locations.filter(
    ({ namedTemple }) => namedTemple,
  )) {
    if (location.templeReferences.length < 2) {
      throw new SourceCulturalPreflightError(
        "A named temple does not have two verified photographic references.",
      );
    }
    for (const [index, reference] of location.templeReferences.entries()) {
      const recorded = await recordSource({
        seriesId: preparation.seriesId,
        source: templeSource(reference, location),
        stableKey: sourceStableKey(
          `temple.${location.canonicalKey}.${index + 1}`,
          reference.sourceMetadataHash,
        ),
        workspaceId: input.workspaceId,
      });
      links.push({
        claimClass: "temple",
        evidenceRole: index === 0 ? "geometry" : "architecture",
        sourceRecordVersionId: recorded.sourceVersionId,
        subjectId: location.locationVersionId,
        subjectKind: "location_version",
      });
    }
  }

  const findings = buildQualifiedReviewFindings(
    preparation.policyRules,
    preparation.subjectHash,
  );
  const sourceLinks = Object.freeze(
    [...links].sort((left, right) =>
      `${left.claimClass}:${left.sourceRecordVersionId}:${left.subjectId}`.localeCompare(
        `${right.claimClass}:${right.sourceRecordVersionId}:${right.subjectId}`,
      ),
    ),
  );
  const sourceSetHash = sha256(postgresJsonbText(sourceLinks));
  const evidenceSetHash = sha256(postgresJsonbText(findings));
  const machineEvidenceHash = sha256(
    postgresJsonbText({
      evidenceSetHash,
      policyHash: preparation.policyHash,
      schemaVersion: "genie.source-cultural-machine-evidence.v1",
      sourceSetHash,
      subjectHash: preparation.subjectHash,
    }),
  );
  const context = worldContext(preparation);
  const contentClasses = [
    ...new Set([
      "general",
      "rights",
      ...(preparation.characters.some(isDeity) ? ["deity_form"] : []),
      ...(preparation.locations.some(({ namedTemple }) => namedTemple)
        ? ["temple"]
        : []),
    ]),
  ];
  const packetId = deterministicUuid(
    `source-cultural-packet:${input.workspaceId}:${preparation.subjectHash}:${sourceSetHash}:${evidenceSetHash}`,
  );
  const { data, error } = await createAdminSupabaseClient().rpc(
    "command_record_bound_source_review_packet",
    {
      p_configuration_candidate_id: preparation.configurationCandidateId,
      p_content_classes: contentClasses,
      p_evidence_set_hash: evidenceSetHash,
      p_findings: findings,
      p_interpretation_labels:
        context.interpretationLabels.length > 0
          ? context.interpretationLabels
          : ["qualified-review"],
      p_language: "Hindi",
      p_machine_evidence_hash: machineEvidenceHash,
      p_machine_verdict: "qualified_review_required",
      p_packet_id: packetId,
      p_policy_version_id: preparation.policyVersionId,
      p_region: context.region,
      p_series_id: preparation.seriesId,
      p_source_links: sourceLinks,
      p_source_set_hash: sourceSetHash,
      p_subject_hash: preparation.subjectHash,
      p_tradition: context.tradition,
      p_workspace_id: input.workspaceId,
      p_world_extraction_result_id: preparation.worldExtractionResultId,
      p_world_reference_pack_version_id: preparation.worldReferencePackVersionId,
    },
  );
  if (error || typeof data !== "string") {
    throw new SourceCulturalPreflightError("The source-review packet was rejected.");
  }
  return Object.freeze({
    packetId: data,
    replayed: data !== packetId,
    scriptSourceVersionId: authorSource.sourceVersionId,
  });
}
