# Genie Series Continuity and Cultural Policy

**Status:** authoritative design companion  
**Scope:** Series inheritance, source provenance, Hindu-tradition fidelity, and
release authority

Genie must preserve a coherent creative world without flattening the plurality
of Hindu traditions into one invented universal canon. The system therefore
versions both continuity and interpretation.

## 1. Authority model

Monica is a machine quality certifier. She may research, classify, detect,
explain, block, and assemble evidence. She is not a priest, theologian, lawyer,
or human editorial authority.

At launch:

- a permitted human reviewer approves every final master;
- every master requires a separate qualified cultural reviewer whose competency
  record covers the relevant tradition/region/content class;
- the owner/admin controls reviewer competency assignments;
- every decision is bound to the exact master and evidence versions reviewed;
- cultural approval and creative/final approval are separate records, even when
  the same qualified person performs both.

The initial owner reviewer may hold broad launch competency. Delegation to
junior teammates may grant creation rights without granting sensitive-release
authority.

## 2. Series Release

A Series Release is an immutable, coherent World Bible containing exact
versions of:

- look manifest and locked style tail;
- characters, deity forms, wardrobe, ornaments, weapons, vahana, and identity
  anchors;
- locations and architectural references;
- narrator and pronunciation lexicon;
- score themes, motif family, and sound rules;
- source registry and interpretive position;
- iconographic, ritual, dignity, violence, romance, caste, and safety rules;
- continuity state carried from earlier episodes.

The first episode is prepared against a Series Draft. One transaction validates
the draft, verifies an authorized Series editor's version-bound `aal2`
Lock-the-world decision, publishes the release, creates the Episode
configuration, and pins the production run. Character/reference packs,
source/rights readiness, deity/temple manifests, and machine cultural preflight
must be current before the draft is publishable. No partial release may become
visible.

Later edits create another release. Existing Episodes remain pinned until a
user adopts the newer release after an impact preview. A critical factual or
cultural correction may mark older configurations stale or unreleasable, but it
never mutates their evidence.

An Episode outcome never writes directly into continuity. After approval,
Monica creates a versioned Outcome Proposal with narrative facts, relationship
changes, newly established visual rules, provenance, and the base continuity
hash. An authorized Series editor accepts, amends, rejects, defers, rebases, or
branches it. Acceptance uses compare-and-swap to create a new continuity
version and Series Release draft. Parallel Episodes stay pinned to their
declared base; explicit outcome dependencies prevent Episode N+1 from
pretending Episode N has been accepted.

## 3. Interpretive classification

Every Episode declares one or more source positions:

- `canonical_text`: attributed to a named primary scripture/edition;
- `traditional_commentary`: attributed to a named commentary or sampradaya;
- `regional_retelling`: a named regional or vernacular tradition;
- `temple_tradition`: a named temple/sthala-purana/practice;
- `popular_retelling`: widely circulated devotional storytelling without a
  single primary textual basis;
- `creative_bridge`: an invented connective scene that does not claim
  scriptural authority.

The UI must not present these as a hierarchy of spiritual legitimacy. They are
provenance labels that prevent one retelling from masquerading as another.
When traditions disagree, Genie states which one it depicts rather than
fabricating a consensus.

## 4. Source registry

Each source record contains:

- stable ID and version;
- title and source class;
- author/compiler/tradition where applicable;
- language, edition, publisher, year, ISBN or stable URL;
- volume, chapter, verse, passage, or page;
- region and sampradaya/temple association where relevant;
- retrieval date and archived evidence handle;
- quoted/extracted proposition in bounded form;
- rights/use basis;
- confidence and contradiction notes;
- creator and qualified reviewer.

Every generation-affecting claim links to one or more source records:

- narrative event;
- relationship;
- deity form and attributes;
- ritual sequence;
- temple architecture;
- costume/social context;
- Sanskrit text and pronunciation;
- prohibited or sensitive depiction.

Model-generated research is never itself a source. It is a lead that must be
resolved to a stable source record.

Every Series/Episode source packet has a Source Review state and immutable
decision. Accepted evidence includes named primary texts/editions, traditional
commentaries, temple or institutional material, reputable scholarship,
rights-cleared reference photography, and explicitly labelled popular/regional
retellings. Social posts, model output, and unsourced summaries are leads only.
Missing stable citations, uncertain generation rights, withdrawn evidence, or
unresolved material contradictions fail closed.

Reviewer competency is a versioned record, not an implication of admin role. It
contains tradition, region, language and content-class scope, appointment
evidence and issuer, effective/expiry dates, suspension/revocation, and
recusal/conflict-of-interest rules. A decision is invalid if competency is
expired, outside scope, suspended, revoked, or subject to a matching recusal.
The initial owner may be explicitly appointed with broad launch scope.

## 5. Named temples and real places

Before depicting a named temple, Genie must:

1. identify the exact temple and location;
2. collect multiple current or historically appropriate reference photographs
   from permitted sources;
3. distinguish temple-specific architecture from generic regional vocabulary;
4. record visible sacred restrictions and photography limitations;
5. create an empty-location anchor before adding generated characters;
6. verify the final establishing frame against the reference evidence.

Reference photographs support factual geometry and detail. They do not imply
permission to reproduce a photographer's expressive framing. If rights or
identity are uncertain, the Episode must use a clearly generic sacred location
and must not name it as the real temple.

## 6. Deity and revered-figure manifests

Every depicted form has a versioned manifest:

- name, form, age presentation, and tradition;
- complexion/skin-tone rule expressed respectfully and consistently;
- number and assignment of arms/hands;
- mudras;
- weapons and objects by hand;
- ornaments, crown, sacred marks, clothing, and garlands;
- vahana and companions;
- emotional register and dignity constraints;
- transformations permitted within the Episode;
- negative constraints and common model failures;
- identity portrait and approved character sheet;
- source evidence and reviewer.

Attribute checks run across sampled frames and transitions, not only hero
frames. A form change must be narratively declared and visually staged; it may
not appear as accidental model drift.

## 7. Sanskrit, mantra, and pronunciation

- Store the exact source text, script, transliteration scheme, meaning/context,
  and use basis.
- Maintain a pronunciation lexicon with word, phoneme/respelling guidance,
  source, speaker evidence when available, and reviewer.
- Do not casually use a mantra as texture, comic material, villain coding, or
  an unrelated impact sound.
- Never splice syllables in a way that changes the locked words.
- Flag uncertain Vedic accent or tradition-specific recitation for qualified
  review rather than fabricating certainty.

## 8. Violence, romance, caste, and dignity

Violence and romance follow the restraint of mainstream Indian devotional
cinema:

- violence may communicate stakes, sacrifice, protection, or dharma without
  fetishized gore;
- aftermath and reaction may carry impact instead of explicit bodily detail;
- romance may be tender, symbolic, marital, or devotional without nudity or
  sexualized treatment of deities;
- minors are never sexualized;
- humiliation is not used as spectacle.

Caste and social roles may be represented when relevant to the era or source.
Genie may show material reality, power, exclusion, occupation, or reform, but
must not turn a historical depiction into present-day hate, biological
essentialism, degrading caricature, or unexamined humiliation. Contested
modern claims require explicit evidence and human review.

The launch product does not create religious-conflict content. It must not
generate antagonistic comparisons, conversion narratives, ridicule, or
incitement involving religions or communities.

## 9. Policy verdict classes

- `pass`: evidence supports generation/release.
- `advisory`: ambiguity is disclosed but does not affect eligibility.
- `repair_required`: the immutable script may remain, but visual/audio/planning
  output must change.
- `qualified_review_required`: machine evidence is insufficient or the topic
  is sensitive.
- `production_blocked`: do not spend on downstream generation.
- `release_blocked`: a candidate may exist but cannot be approved.
- `non_overridable`: the product cannot waive the blocker.

Non-overridable examples:

- nudity or sexualized deity/minor;
- religious-conflict content;
- degrading or hateful caste depiction;
- deliberate scriptural misattribution;
- identity-defining deity attributes missing or assigned to the wrong form;
- provider-policy-prohibited material;
- absent rights for a required uploaded/reference asset.

Eligible exceptions require:

- the exact rule and affected version;
- evidence;
- plain-language rationale;
- scope and expiry;
- admin approval;
- qualified-reviewer approval;
- full audit event.

An exception cannot change a `non_overridable` verdict.

## 10. Review evidence

The final cultural packet includes:

- Series Release and Episode interpretation labels;
- source registry extract;
- deity/form manifests;
- temple/reference packet when applicable;
- Sanskrit/pronunciation packet;
- policy checks with timestamps/frames;
- machine confidence and disagreements;
- exceptions;
- qualified reviewer identity, competency scope, verdict, and timestamp;
- exact master checksum.

Approval is invalidated when the master, script, Series Release, cultural
configuration, or cited evidence changes.

## 11. Initial operating posture

Until the benchmark set and actual production feedback calibrate Monica:

- every final release is human-approved;
- every final release receives separate qualified cultural review;
- machine confidence is labelled provisional;
- detector misses and false positives become evaluation-set fixtures;
- no automated pass rate is treated as proof of cultural correctness.
