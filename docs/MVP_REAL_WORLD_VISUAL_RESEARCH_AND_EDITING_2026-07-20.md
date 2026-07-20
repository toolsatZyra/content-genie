# MVP real-world visual research and editing decision

**Status:** accepted product design, with the named-temple slice implemented
and the festival/ritual subject extension required before software-complete.

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
4. de-duplicate exact and near-duplicate images, cluster candidates by visible
   moment/view, and select up to four factually relevant but visually distinct
   references per subject;
5. quarantine, validate, and promote selected media through the existing
   research-reference ingest boundary;
6. expose the selected contact sheet and provenance to the cultural/world
   review before World Lock;
7. let the Director/EDD allocate one or more approved reference IDs to each
   applicable shot, preferring unused references and permitting repetition only
   when continuity calls for the same view; and
8. bind those IDs into the executable prompt/reference graph so the image and
   video providers receive the reference whenever that subject is visible.

The current named-temple implementation already performs licence filtering,
metadata capture, quarantine scanning, provenance recording, and reference-led
location generation. It now retains up to four eligible photographs. Festival
and ritual subjects need the same contract generalized beyond a location whose
type is `namedTemple`; that extension is an MVP completion item, not a claim of
current coverage.

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
sufficient only as renderer proofs. The production rule is now one planned
visual slot per three seconds of locked narration: `ceil(duration_ms / 3000)`,
or 20-40 shots across the 60-120 second launch range. Slot boundaries are
aligned to the narration alignment, and the EDD records exact text, Unicode
scalar coordinates, and millisecond coordinates for every shot. The renderer
cuts on those EDD timestamps. The owner remains the release authority and may
use the one bounded rejection and repair pass.

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
- The festival/ritual extension proves one representative named festival and
  one representative named ritual with distinct references allocated to the
  applicable storyboard shots.
- A 60-120 second render contains 20-40 word-bound visual slots; cut points
  follow the locked EDD timestamps and the final media probe reports H.264,
  1080x1920, `yuv420p`, and the locked narration duration.
- The final owner review can reject once with direction, rerender, approve, and
  download the approved master.
