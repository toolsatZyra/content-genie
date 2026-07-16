# Genie by Zyra

An internal, multi-user AI film studio that turns exact Hindi narration scripts
from Indian scriptures and traditions into cinematic vertical 60–120 second
episodes. A durable agent crew plans, casts, generates, edits, scores,
quality-controls, repairs, and packages each film while users continue working
on other productions.

**Status:** design gate passed; implementation planning is next.

**Owner review artifact:** [`Genie by Zyra - End-to-End Solution Design.docx`](docs/Genie%20by%20Zyra%20-%20End-to-End%20Solution%20Design.docx)

## Start here

1. **[`docs/design.md`](docs/design.md)** — the authoritative product and
   solution build contract.
2. **[`DESIGN.md`](DESIGN.md)** — the Living Cinema interaction and visual
   design source of truth.
3. **[`reference/rubric-config/`](reference/rubric-config/)** — the
   machine-readable visual, script, and non-scored QC rubrics.
4. **[`docs/archive/research-design-2026-07-10.md`](docs/archive/research-design-2026-07-10.md)**
   — preserved research specification; useful evidence, but not current scope.
5. **[`docs/reference-porting-map.md`](docs/reference-porting-map.md)** —
   verified seams and defects in the AI Director reference implementation.
6. **[`docs/provider-contract.md`](docs/provider-contract.md)** — provider
   routing, freshness, evidence, and infrastructure decisions. Documentation
   observations remain distinct from authenticated production canaries.
7. **[`docs/cost-envelope.md`](docs/cost-envelope.md)** — dated 60/90/120-second
   feasibility BOM, quote/reservation flow, and production proof obligations.
8. **[`docs/qc-release-contract.md`](docs/qc-release-contract.md)** —
   stage-specific rubric applicability and release evidence.
9. **[`docs/state-and-data-contract.md`](docs/state-and-data-contract.md)** and
   **[`docs/threat-model.md`](docs/threat-model.md)** — concurrency,
   transactional, authorization, and security contracts.
10. **[`docs/series-and-cultural-policy.md`](docs/series-and-cultural-policy.md)**
   — Series continuity, sources, tradition, and review authority.
11. **[`docs/design-adversarial-review.md`](docs/design-adversarial-review.md)**
    — independent design-gate findings, resolutions, and residual external
    proof gates.
12. **[`docs/sdlc.md`](docs/sdlc.md)** — phased adversarial delivery and
     verification process.
13. **[`docs/project-state.md`](docs/project-state.md)** — durable continuation
     handoff protecting against context degradation.
14. **`.env.local`** — local credentials (git-ignored; never commit).

## Build order

The phase plan, requirements traceability, acceptance gates, and verification
commands live in `docs/implementation-plan.md` once the design adversarial review
is closed.

## External assets this project ports

The 117-look gallery, prompt corpus, reference graph, and Character Studio
patterns are ported selectively from `C:\Work\Code\ai-director`. Rubric configs
come from `C:\Work\Code\microdrama-evaluator` and are vendored under
`reference/`.
