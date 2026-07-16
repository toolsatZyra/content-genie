# AI Director to Genie — Verified Porting Map

**Status:** design input  
**Verified against:** `C:\Work\Code\ai-director` on 2026-07-17  
**Rule:** port contracts and tests, not the prior application's architecture.

## 1. Looks and style tails

Verified sources:

- `src/lib/styles/curatedLooks.ts`
- `tools/look-gen/all-looks.json`
- `src/components/LookGalleryModal.tsx`
- `src/components/SetTheLookStage.tsx`
- `src/app/api/projects/[id]/references/from-look/route.ts`
- `src/lib/agents/styleAnalyzer.ts`
- `src/lib/prompts/styleAnalyzer/base.ts`
- `src/lib/agents/promptEngine.ts`
- `src/lib/prompts/negativeTint.ts`

Verified behavior:

- exactly 117 looks across nine families;
- selecting a look uploads/copies its preview as the visual reference;
- a vision model analyzes the preview into an editable 50–150 word style tail;
- the approved style tail is locked;
- image prompts use:

```text
<shot-specific frame description>

<verbatim locked style tail, including any approved anti-tint sentence>
```

Port:

- visual gallery and family/search interactions;
- locked-tail invariant;
- exact double-newline boundary;
- editable style analysis;
- frozen look-test scenes;
- tint policy as explicit configuration compiled into the locked second block.

Correct before porting:

- replace duplicate TypeScript/JSON catalogs with one typed manifest;
- decide per look whether the tail is deterministic reviewed data or generated
  by thumbnail analysis.

Genie resolves the remaining origin choice at import: each of the 117 records
is materialized once into a reviewed, deterministic manifest entry. Runtime
prompting never analyzes the thumbnail again and never emits a third prompt
block. The byte-testable grammar is exactly:

`frame_block + "\n\n" + locked_look_block`

## 2. Character Studio, locations, and sheets

Verified sources:

- `src/components/CharacterStudio.tsx`
- `src/components/ProjectStageView.tsx`
- `src/lib/agents/rosterDeducer.ts`
- `src/lib/fal/characterSheet.ts`
- `src/lib/fal/entityReference.ts`
- `src/app/api/projects/[id]/character-sheets/route.ts`
- `src/app/api/projects/[id]/reference-image/route.ts`

Port:

- roster extraction;
- concise permanent identity/location briefs;
- generated or uploaded anchors;
- uploaded-reference analysis;
- neutral character portrait;
- multi-view character sheet;
- empty location establishing reference;
- atomic per-asset state updates and watchdog reconciliation.

Critical contract:

- clean single-character portraits are generation identity anchors;
- multi-view sheets are approval and derived-reference artifacts;
- feeding a collage sheet directly as the primary likeness reference increases
  identity drift.

Correct before porting:

- use normalized entity/version tables, not one mutable JSON roster;
- bill every character/product/location/sheet operation through the append-only
  ledger;
- explicitly connect canonical location anchors to the reference graph.

## 3. Prompt Engine

Verified sources:

- `src/lib/agents/promptEngine.ts`
- `src/lib/prompts/promptEngine/base.ts`
- `src/lib/prompts/promptEngine/batchSlice.ts`
- `src/lib/pipeline/runStage.ts`

Port:

- bounded batch generation;
- exact scene/shot identity validation;
- count validation and malformed-output retry;
- named identity and location bindings;
- sound/transition stripping before visual prompting;
- verbatim tail enforcement;
- resume-safe cached agent-call records.

Genie must retain a single typed prompt result schema and fail closed on
identity/count mismatch.

## 4. Reference graph

Verified sources:

- `src/lib/agents/referenceGraph.ts`
- `src/lib/graph/referenceGraph.ts`
- `src/lib/graph/masterCoverage.ts`
- `src/lib/pipeline/planRenderOrder.ts`
- `src/lib/pipeline/shotStaleness.ts`
- `src/lib/pipeline/composeShotReferences.ts`
- `src/lib/fal/renderShot.ts`
- `src/components/ReferencePickerModal.tsx`

Port:

- cycle detection;
- capped deterministic graph;
- master-coverage selection;
- previous-master/same-location continuity;
- topological render order;
- upstream-failure spend prevention;
- content-hash staleness;
- subject/environment-specific reference instructions.

Correct before porting:

- one authoritative reference resolver;
- canonical location anchors precede shot-to-shot environment edges;
- one documented reference cap;
- later-shot references are rejected at API and UI boundaries;
- duplicated pipeline resolution logic is removed.

## 5. Provider adapters

Verified sources:

- `src/lib/agents/anthropicClient.ts`
- `src/lib/agents/openaiClient.ts`
- `src/lib/fal/client.ts`
- `src/lib/fal/renderShot.ts`
- `src/lib/fal/videoRender.ts`

Do not port direct SDK coupling. Implement:

```ts
interface GenerationResult<T> {
  value: T;
  provider: string;
  model: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    seconds?: number;
    images?: number;
  };
  externalRequestId?: string;
  attempts: number;
}
```

Retry classification, fallback, capabilities, costs, provenance, and request IDs
belong behind typed adapters.

## 6. Cost and usage

Reusable:

- pure typed operation cost calculations from:
  - `src/lib/cost/prices.ts`;
  - `src/lib/cost/calculateCost.ts`.

Do not port:

- mutable accumulated project totals;
- static prices without `verified_at`;
- per-shot overwrite cost fields;
- incomplete UI totals;
- dropped failed/billed calls.

Genie uses append-only `usage_events` and `cost_events` with:

- provider/model/operation;
- quantity and unit;
- rate-card version;
- request/idempotency IDs;
- outcome including `billed_no_asset`;
- reservation, actual cost, and retry relationship.

## 7. Video routing

Verified sources:

- `src/lib/fal/videoCapabilities.ts`
- `src/lib/fal/videoModels.ts`
- `src/lib/agents/videoPlanner.ts`
- `src/lib/fal/videoRender.ts`
- `src/lib/video/runner.ts`
- `src/app/api/projects/[id]/video/generate/route.ts`

Reusable:

- declarative capability-table concept;
- queue claims;
- bounded concurrency;
- stored provider outputs;
- Kling refusal-only fallback;
- Seedance multi-reference path;
- media hosting/recompression.

Do not claim as implemented:

- chained final-frame extraction;
- runner-driven Kling start/end frames;
- Kling 3 multi-shot/elements;
- content-safe routes that cannot be selected end-to-end;
- incompatible multi-frame Kling input support.

Genie requirements:

- validate every capability row against a live provider schema;
- reject incompatible frame/model combinations before enqueue;
- type start frame, end frame, ordered references, elements, multi-shot prompts,
  and clip-chain extraction separately;
- advertise only reachable, tested behavior.

## 8. Test evidence

The reference audit ran 34 targeted suites and 253 tests successfully across:

- looks and style tails;
- prompts;
- character/roster/sheets;
- graph algebra and scheduling;
- cost calculations;
- video planning, rendering, and queue behavior.

Genie should port or re-express those tests before changing behavior, then add
coverage for the corrected contracts above.
