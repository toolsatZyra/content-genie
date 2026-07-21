# Genie Launch Cost Envelope

**Status:** normative feasibility and reservation contract  
**Evidence date:** 2026-07-17  
**Production status:** unverified until authenticated account canaries and billing
reconciliation pass  
**Parent contracts:** `docs/design.md`, `docs/provider-contract.md`

## 1. What this document proves

The target of less than USD 40 where possible remains useful for observability.
For the owner-operated developer MVP, the complete exact forecast is recorded
and authorized without pausing at USD 50. A data-derived cap will be chosen
after several days of real usage. Capability-aware routing, early keyframe
rejection, bounded candidate multipliers, and 720p-to-1080p conform still
control waste without lowering quality.
It is not feasible to send every retained second through the most expensive
lane or to generate unbounded alternatives.

The numbers below are a worked design envelope, not a price promise. Production
quotes are calculated from authenticated, dated account rate cards. A stale,
missing, or contradictory rate card blocks paid enqueue.

## 2. Dated evidence used

The content-addressable evidence payload is
`docs/evidence/provider-snapshots/fal-2026-07-17.json`. Conservative design rates
are:

| Capability | Design rate | Use |
|---|---:|---|
| Kling 2.5 Turbo Pro | USD 0.070/generated second | simple camera and simple subject motion |
| Kling 3 Pro, native audio off | USD 0.112/generated second | camera-led shots |
| Seedance 2 reference, 720p standard, no video-input discount | USD 0.3034/generated second | other complex/reference-led shots |
| Nano Banana 2 standard | USD 0.080/image | world anchors, sheets, keyframes, repairs |
| Topaz video upscale, 720p to 1080p | USD 0.020/retained second | accepted clip conform only |

The Seedance and Kling 3 pages exposed internal pricing discrepancies. The BOM
uses the higher Seedance value and the endpoint-specific Kling 3 audio-off
table. Dispatch must compare the authenticated quote and block on disagreement.

## 3. Planning assumptions

The representative route mix is 50% Kling 2.5, 20% Kling 3, and 30% Seedance.
It is a feasibility profile, not a fixed artistic quota. Monica may choose a
different lane only when the current quote remains within the authorized
ceiling and the lane is quality-qualified for that shot.

Candidate multiplier means generated video seconds divided by retained master
seconds:

- low: 1.30x;
- expected: 1.80x;
- high: 2.50x.

The high case is a hard planning boundary, not permission to continue retrying.
Failed keyframes do not proceed to video. Video candidates are upscaled only
after retention. Image and non-video allowances include planned alternatives,
world sheets, speech, alignment, music/SFX, reasoning/judging, render, storage,
and ordinary diagnostics. Until authenticated provider/subscription rates are
known, these are reservation allowances rather than claims of incurred price.

### 3.1 Execution quote mechanics

The multipliers above are portfolio feasibility assumptions only. They MUST
NOT be used as the executable quote. Before authorization, the planner expands
the EDD into an itemized request bill of materials. Every planned request row
contains:

- shot/stage ID, provider account, endpoint and authenticated rate-card version;
- requested duration, provider-accepted duration value, billing quantum,
  minimum billable duration, rounding rule, output count, resolution, quality
  tier, native-audio flag and every price modifier;
- low/expected/high candidate count for that exact shot class;
- per-attempt price, per-shot retry allowance and terminal dollar limit;
- retained-upscale seconds and exact image/audio/non-video units;
- confidence source and the canary/billing receipt that verified the rule.

`billable_duration` is computed by versioned adapter code from the authenticated
rate-card rule. It is never assumed to equal retained timeline duration. For
example, Kling 2.5 plans only supported 5- or 10-second requests; a shorter
retained excerpt still reserves the full chosen request duration. Other
endpoints use their authenticated duration quantum, rounding and minimums.

The quote compiler sums the request rows independently for low, expected and
high cases. The high case includes every authorized retry slot and bounded
alternate route. The system reserves the full high envelope before paid
enqueue. A retry consumes a pre-existing per-shot slot; adding a slot, changing
route/modifiers, or crossing the high envelope creates a new quote version and
requires new authorization. Unverified quantum, rounding, minimum, multiplier,
tax/fee treatment or rate disagreement blocks dispatch.

Each base, retry and alternate row is one claimable slot. A provider request
atomically claims exactly one unused slot; the claim does not reserve money a
second time. Slot/request uniqueness and exact field matching prevent both
double consumption and unauthorized substitutions.

### 3.2 Fully itemized 60-second high-envelope example

This example exercises the executable shape with integer request slots. It is
auditable design evidence, not a dispatchable production quote: the video,
image and upscale rows use the dated public rates above, while reserve-only
non-video rows remain blocked from provider dispatch until authenticated rate
cards replace them.

The retained plan has seven shots: three 10-second Kling 2.5 shots, two
6-second Kling 3 shots and two 9-second Seedance shots. Its base video cost is
USD 8.9052. The high envelope explicitly authorizes five retry slots and two
Seedance alternate-route slots:

| Slot IDs | Kind | Exact request units | Quantity | Unit rate | High amount |
|---|---|---:|---:|---:|---:|
| `K25-B01..B03` | base | Kling 2.5, 10 billable seconds | 3 | 0.070/s | 2.1000 |
| `K3-B01..B02` | base | Kling 3 Pro audio off, 6 billable seconds | 2 | 0.112/s | 1.3440 |
| `SD-B01..B02` | base | Seedance 720p standard, 9 billable seconds | 2 | 0.3034/s | 5.4612 |
| `K25-R01..R02` | retry | Kling 2.5, 10 billable seconds | 2 | 0.070/s | 1.4000 |
| `K3-R01` | retry | Kling 3 Pro audio off, 6 billable seconds | 1 | 0.112/s | 0.6720 |
| `SD-R01..R02` | retry | Seedance 720p standard, 9 billable seconds | 2 | 0.3034/s | 5.4612 |
| `SD-A01..A02` | bounded alternate | Seedance 720p standard, 9 billable seconds | 2 | 0.3034/s | 5.4612 |
| `UP-B01` | retained conform | Topaz 720p-to-1080p, 60 input seconds | 1 | 0.020/s | 1.2000 |
| `IMG-B01..B45` | image/sheet/keyframe slots | Nano Banana 2 standard image | 45 | 0.080 | 3.6000 |
| `ALLOW-NARR` | reserve-only | narration and alignment allowance | 1 | fixed | 1.5000 |
| `ALLOW-MUSIC` | reserve-only | score and SFX allowance | 1 | fixed | 1.7500 |
| `ALLOW-JURY` | reserve-only | LLM/VLM evaluation allowance | 1 | fixed | 2.2500 |
| `ALLOW-RENDER` | reserve-only | render, storage and diagnostics allowance | 1 | fixed | 1.0000 |
| `ALLOW-LATE` | reserve-only | bounded late-billing liability allowance | 1 | fixed | 0.5000 |
|  |  |  |  | **Full high envelope** | **33.6996** |

The 14 video slots represent 122 generated seconds, or 2.03x retained duration,
below the 2.50x portfolio high boundary. Authorization reserves USD 33.70 once.
If, for example, `K3-R01` is needed, the provider request claims that exact USD
0.672 slot without changing the reserved balance. A seventh retry, a 10-second
substitution, audio-on Kling, native 1080p, or any different modifier has no
matching slot and therefore cannot enqueue without a replacement quote and
authorization.

## 4. Worked low / expected / high BOM

### 4.1 Sixty-second Episode

Retained base video: 30s Kling 2.5 + 12s Kling 3 + 18s Seedance =
USD 8.91.

| Cost component | Low | Expected | High |
|---|---:|---:|---:|
| Generated video candidates | 11.58 | 16.03 | 22.26 |
| Retained 720p-to-1080p upscale | 1.20 | 1.20 | 1.20 |
| Image generations/repairs | 1.60 | 2.40 | 3.60 |
| Voice, alignment, sound, LLM/VLM, render, storage allowance | 2.50 | 4.50 | 7.00 |
| **Episode total** | **16.88** | **24.13** | **34.06** |

### 4.2 Ninety-second Episode

Retained base video: 45s Kling 2.5 + 18s Kling 3 + 27s Seedance =
USD 13.36.

| Cost component | Low | Expected | High |
|---|---:|---:|---:|
| Generated video candidates | 17.37 | 24.04 | 33.39 |
| Retained 720p-to-1080p upscale | 1.80 | 1.80 | 1.80 |
| Image generations/repairs | 2.00 | 3.20 | 4.80 |
| Voice, alignment, sound, LLM/VLM, render, storage allowance | 3.00 | 5.50 | 8.00 |
| **Episode total** | **24.17** | **34.54** | **47.99** |

### 4.3 One-hundred-twenty-second Episode

Retained base video: 60s Kling 2.5 + 24s Kling 3 + 36s Seedance =
USD 17.81.

| Cost component | Low | Expected | High |
|---|---:|---:|---:|
| Generated video candidates | 23.15 | 32.06 | 44.53 |
| Retained 720p-to-1080p upscale | 2.40 | 2.40 | 2.40 |
| Image generations/repairs | 2.40 | 4.00 | 6.40 |
| Voice, alignment, sound, LLM/VLM, render, storage allowance | 3.50 | 6.50 | 9.50 |
| **Episode total** | **31.45** | **44.96** | **62.83** |

The 120-second high case is intentionally allowed in the owner-operated MVP.
Genie records forecast and settlement, prevents duplicate spend, and keeps
automatic retries bounded. It must never silently lower QC thresholds.

## 5. Authorization sequence

1. At Episode creation, Genie records the exact cost policy version. The
   owner-operated MVP has no arbitrary USD 50 pause.
2. Every world-asset generation reserves its own bounded micro-budget against
   that ceiling and shows its estimated incremental cost.
3. Before `Begin autonomy`, Genie presents route assumptions and the
   low/expected/high quote.
4. Genie seals the exact high execution envelope under standing developer-MVP
   authority. The amount, assumptions, and version remain visible.
5. No paid video request may enter the outbox until the full itemized high
   envelope is reserved and it is at or below the authorized hard ceiling.
6. Repair Plans receive separate delta low/expected/high values and their own
   explicit hard ceiling.
7. Unknown, late, canceled, refused, and billed-without-asset liabilities enter
   the append-only ledger and reduce remaining authority until reconciled.

## 6. Production proof still required

Before calling the cost target verified:

- run authenticated canaries for every enabled endpoint and rate unit;
- validate ElevenLabs and model-judge subscription/account costs;
- measure real candidate multipliers by shot class;
- load-test provider concurrency for five Episodes per day;
- reconcile estimated versus settled provider bills;
- publish per-Episode route, retry, discard, upscale, and non-video costs;
- show that the 95th-percentile 90-second Episode remains at or below the
  authorized ceiling without lowering the release contract.

Until then the product may be software-complete and provider-enabled, but the
cost target remains **design-feasible, not production-verified**.
