# Zyra Studio

An internal, multi-user, agent-native web application that turns micro-drama scripts from Indian scriptures into finished vertical (9:16) 60–120s episodes — planned, cast, generated, edited, quality-controlled, and packaged by a crew of AI agents on a durable production pipeline, with human green-light gates.

**Status: pre-build.** This repository currently contains the complete design specification and reference materials. No application code exists yet.

## Start here

1. **[`docs/design.md`](docs/design.md)** — the build contract. Product, design decisions, the 11-stage pipeline, agent architecture, team model, data model, consistency system, directing grammar, cultural-safety engine, QC (defect funnel + quality rubric), model routing, deliverables, costs, tech stack, risks, validation spikes, roadmap, and reference materials.
2. **[`reference/rubric-config/`](reference/rubric-config/)** — the machine-readable quality rubrics (visual, script, checks) used by the QC layer at Gate B (plan scoring) and S9 (finished scoring). See `docs/design.md` §12 and §21.
3. **`.env.local`** — provider credentials and connection info (git-ignored; never commit). Keys already on hand are filled in; missing ones are marked with where to obtain them.

## Build order

Follow `docs/design.md` §18 (validation spikes) and §19 (roadmap): run the cheap spikes that de-risk pricing/capability assumptions, then build Phase 0 (the quality-risk skeleton — exit criterion: one genuinely publishable episode and a 6-shot scene that reads as one continuous scene), then Phase 1 (the full studio).

## External assets this project ports

Listed with exact paths in `docs/design.md` §21: the 115-look gallery, prompt corpus, reference-graph algebra, and Character Studio / Look Picker UI from `C:\Work\Code\ai-director`; the rubric configs from `C:\Work\Code\microdrama-evaluator` (already vendored under `reference/`); and the ~250-page microdrama research corpus under `C:\Work\Code\microdrama-evaluator\input-research\`.
