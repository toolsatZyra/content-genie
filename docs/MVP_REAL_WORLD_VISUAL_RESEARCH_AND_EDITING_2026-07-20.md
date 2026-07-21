# MVP real-world visual research and editing decision

**Status:** implemented developer-MVP contract. A full owner Episode remains
the final product-behaviour proof.

## Real-world visual research

When the immutable script explicitly names a real temple, festival, or ritual,
Genie must create an evidence-bound visual reference set before storyboard and
shot generation. A web page being public does not by itself grant reuse rights.
The MVP therefore uses only source files with recorded reusable licence or
public-domain evidence. Search results are discovery leads, not licence proof.

The visual research scout must:

1. extract only explicitly named real-world visual subjects from the locked
   script and preserve the relevant script coordinates as sidecar evidence;
2. search allowlisted public catalogues, beginning with Wikimedia Commons, and
   retain the file page, original author, licence name and URL, source URL,
   dimensions, retrieval evidence, and content hash;
3. reject candidates without an adequate reusable licence, subject match, or
   minimum usable resolution;
4. de-duplicate source pages and downloaded photo bytes, continue through later
   candidates after a duplicate, preserve catalogue relevance order, and
   select up to four factually relevant references per subject;
5. quarantine, validate, and promote selected media through the existing
   research-reference ingest boundary;
6. expose the selected contact sheet and provenance to the cultural/world
   review before World Lock;
7. let the Director/EDD allocate one or more approved reference IDs to each
   applicable shot, preferring unused references and permitting repetition only
   when continuity calls for the same view; and
8. bind those IDs into the executable prompt/reference graph so the image and
   video providers receive the reference whenever that subject is visible.

The implementation now applies this contract to explicitly named temples,
festivals, and rituals. World Extraction records the subject class and
canonical public name. The research scout searches public file records,
requires subject-class evidence, filters reusable licences and resolution,
quarantines and re-encodes the files, and retains two to four references. The
Director must select one approved photo for every applicable three-second shot
and cannot repeat it until the alternatives have been used. The selected asset
ID is written into the immutable EDD and executable reference graph, where the
database verifies that it belongs to the selected location's verified research
packet. Production requires the EDD and graph IDs to match and uses that asset
as the actual image-to-video source for the exact narration window.

Random Google Images results, unverified social posts, and pages whose licence
cannot be established are not production inputs. Google image usage-rights
filters can aid discovery, but the source file's licence page remains the
evidence of record.

## Editing decision

The MVP renderer remains deterministic FFmpeg running in an ephemeral Vercel
Sandbox. Remotion is not required for the first owner-operated release because
the output is a single 9:16 narration-led montage without interactive layouts
or a large motion-graphics system.

Editing judgement is split deliberately:

- the Director/EDD owns narrative beats, shot order, shot start times, visual
  intent, framing, camera motion, subject action, emotional read, lighting,
  motion-provider class, and approved reference IDs;
- providers create the motion clips from those locked shot inputs; and
- the renderer executes the EDD, normalizes every clip to 1080x1920/30 fps,
  trims or loops each selected clip only for its assigned editorial interval,
  concatenates the planned intervals, and maps the locked narration to the
  exact 60-120 second master.

The earlier six-clip repeating concat and the intermediate twelve-beat cap were
sufficient only as renderer proofs. `ceil(duration_ms / 3000)` is now creative
planning guidance, not a minimum, maximum, database constraint, or acceptance
rule. The Director first creates semantic shots and assigns each one an exact,
contiguous span of immutable script words. After the final ElevenLabs narration
exists, word alignment gives those shot spans their exact millisecond windows.
The EDD records the exact text, Unicode scalar coordinates, and resulting
millisecond coordinates, and the renderer cuts on those timestamps.

Provider request durations are derived from the aligned editorial window. When
a provider accepts only whole-second quanta, Genie requests the smallest
supported duration that covers the shot plus a small edit handle, then trims to
the exact aligned duration. It never loops or time-stretches a short clip to
fill the window. A shot may be subdivided at a phrase/action boundary only when
its actual duration or action cannot be generated coherently by a qualified
provider.

A Seedance multi-shot generation may cover adjacent slots in one longer source
clip (for example, five planned visual changes in a 15-second clip), but only
when each internal change is mapped to the same exact word/time ranges. A long
source clip never reduces the required editorial coverage or permits a static
15-second visual.

Add Remotion later only if user testing demonstrates a need for reusable motion
graphics, animated captions, complex branded layouts, or browser-previewable
compositions. It should not be added merely to replace deterministic cuts that
FFmpeg already executes reliably.

## Focused MVP acceptance

- A named-temple script produces two to four licensed, provenance-visible,
  non-identical references and binds them to the generated location identity.
- Public-catalogue canaries return multiple file candidates for a representative
  named festival, ritual, and temple; unit evidence proves distinct references
  are allocated to applicable storyboard shots before reuse.
- A 60-120 second render contains the Director's evidence-bound semantic shots;
  `ceil(duration_ms / 3000)` is available as guidance but is never enforced.
  Cut points follow the locked word-aligned EDD timestamps and the final media
  probe reports H.264, 1080x1920, `yuv420p`, and the locked narration duration.
- Stage 6 is labelled Edit and keeps production progress, final playback,
  repair feedback, Monica's authoritative repair progress, approval, and
  downloads inside the six-stage Episode flow. It never redirects to a separate
  production screen.
- A review-ready master can always be downloaded. After approval, Genie also
  provides a complete package of every storyboard image and video clip used by
  that approved master, with a manifest and checksums.
