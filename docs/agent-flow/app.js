const looks = Array.isArray(window.ZYRA_LOOKS) ? window.ZYRA_LOOKS : [];

const DEFAULT_LOOK_ID = "glowing-divine-realism";
let selectedLook = looks.find((look) => look.id === DEFAULT_LOOK_ID) || looks[0] || {
  id: DEFAULT_LOOK_ID,
  name: "Glowing Divine Realism",
  family: "Indian Mythology",
  feel: "Cinematic hyper-real devotional drama"
};
let customStyleTail = "";

const stages = [
  {
    id: "01", phase: "Define", phaseColor: "#bd5429", title: "Submit the exact script",
    agent: "Episode Orchestrator", input: "User script", action: "Hash & annotate", output: "ImmutableScript + Sidecar",
    summary: "Dialogue, speakers, addressees, actions and scene order are accepted exactly as supplied. The agent adds production intelligence beside the script—it does not rewrite it.",
    steps: ["Persist the original bytes and create a script revision hash", "Parse speakers, addressees, scenes, actions and dialogue without editing them", "Attach pronunciation, emotion, timing, source and safety annotations in a sidecar", "If a blocking issue exists, ask the user for a new revision instead of silently fixing it"],
    contracts: ["ScriptHashIntegrity", "DialogueAndSpeakerIdentity", "NoUnauthorizedMutation", "SidecarTraceability"],
    touch: { status: "Required", label: "Human decision 1 of 4", copy: "The user supplies the complete production script. This is the creative source of truth for the episode.", trigger: "Future topic-to-script generation is a separate upstream add-on—not part of this script-to-video contract." },
    viewer: { type: "custom", custom: "script", title: "The text is visibly locked", caption: "The UI makes a hard distinction between the user's script and the agent's additive production annotations." }
  },
  {
    id: "02", phase: "Define", phaseColor: "#bd5429", title: "Pick the visual look",
    agent: "Visual Canon Agent", input: "117-look library", action: "Read visual DNA", output: "LockedStyleTail",
    summary: "The user chooses a look before any character or location is generated. Glowing Divine Realism opens as the default Indian Mythology look.",
    steps: ["Open directly on the Indian Mythology family—no Recommended tab", "Search or browse all 117 real AI Director looks", "Treat the selected look image as the visual reference", "Generate a reusable Nano Banana style tail and keep it inspectable"],
    contracts: ["LookReferencePinned", "StyleTailDerivation", "TwoSceneLookTest", "TailAppliedVerbatim"],
    touch: { status: "Required", label: "Human decision 2 of 4", copy: "The user chooses the visual universe. The generated tail is automatic; editing it is an optional power-user action, not another gate.", trigger: "Changing the look later invalidates character, location, sheet, keyframe and motion assets derived from the older lock." },
    viewer: { type: "custom", custom: "look", title: "One playful decision shapes the whole film", caption: "The chosen visual reference becomes Block 2 of every Nano Banana prompt, after the shot-specific composition paragraph." }
  },
  {
    id: "03", phase: "Lock", phaseColor: "#7b5ab6", title: "Generate cast & locations",
    agent: "Visual Canon Agent", input: "Script + style tail", action: "Imagine the world", output: "ApprovedAnchors",
    summary: "The agent detects every character and recurring location, then generates clean anchor images inside the selected look before production begins.",
    steps: ["Create a clean front portrait for every detected character", "Create an empty establishing reference for each recurring location", "Expose the exact subject/location prompt while keeping the look tail locked", "Offer the same three actions everywhere: accept, edit prompt and regenerate, or upload"],
    contracts: ["RosterCompleteness", "PromptProvenance", "IdentityAndLocationAnchor", "RightsAndUploadConsent"],
    touch: { status: "Required", label: "Human decision 3 of 4", copy: "The user locks the cast and world. Every card supports Accept, Edit prompt → Regenerate, and Upload your own.", trigger: "Nothing downstream starts until all required characters and locations have a chosen anchor." },
    viewer: { type: "custom", custom: "assets", title: "The world is editable without becoming complicated", caption: "The user edits creative intent, not model parameters. Prompt and references remain one click away." }
  },
  {
    id: "04", phase: "Lock", phaseColor: "#7b5ab6", title: "Create character sheets",
    agent: "Visual Canon Agent", input: "Approved portraits", action: "Expand identity", output: "CharacterSheets",
    summary: "Once anchors are locked, the agent automatically generates a 16:9 multi-view sheet for each character in the selected look.",
    steps: ["Generate front, left profile, right profile, rear and close-up views", "Keep face, hair, build, wardrobe and proportions identical", "Use a neutral seamless studio background with no story-state contamination", "Store the clean portrait as the render anchor; use the sheet as identity intelligence and review evidence"],
    contracts: ["SamePersonAcrossViews", "CleanStudioReference", "WardrobeAndProportionLock", "LookTailInheritance"],
    touch: { status: "Automatic", label: "Agent-owned", copy: "No routine approval is introduced here. The approved portrait and style lock are sufficient to create the sheet automatically.", trigger: "A failed identity contract regenerates the sheet; it does not send the user into another mandatory setup screen." },
    viewer: { type: "custom", custom: "sheets", title: "One identity, five useful views", caption: "The sheet gives later image and video models stronger evidence for profile, full-body, rear and close-up shots." }
  },
  {
    id: "05", phase: "Autopilot", phaseColor: "#397487", title: "Direct the episode",
    agent: "Story, Audio & Edit Agents", input: "Locked script + world", action: "Annotate & plan", output: "AudioMaster + EDD",
    summary: "The immutable script is enriched into performance, timing, shot, sound and edit plans. The narration becomes the master clock without changing a line.",
    steps: ["Compile pronunciation, performance, pause and breath instructions", "Generate and select expressive voice candidates by script segment", "Build beat coverage, rhythm, camera, composition and edit decisions", "Assemble each image prompt as Block 1 scene content + Block 2 locked look tail"],
    contracts: ["ExactTextPerformance", "PronunciationAndProsody", "CoverageAndRhythm", "PromptBlockSeparation"],
    touch: { status: "Automatic", label: "Autonomous production tunnel", copy: "After the world is locked, the user is no longer asked to approve narration, shot lists, quotes or edit plans in the launch flow.", trigger: "The system repairs weak plans automatically or fails closed when it cannot preserve the script and quality floor." },
    viewer: { type: "custom", custom: "planning", title: "Add intelligence around the script—not into it", caption: "The sidecar grows richer while the dialogue, speaker relationships and scene order remain byte-for-byte attributable." }
  },
  {
    id: "06", phase: "Autopilot", phaseColor: "#397487", title: "Generate keyframes & clips",
    agent: "Generation & Edit Agent", input: "EDD + anchors", action: "Generate & conform", output: "AcceptedClips",
    summary: "The agent creates multiple visual candidates, selects strong keyframes, animates them, and repairs identity, anatomy, motion and continuity defects.",
    steps: ["Pass only the characters and locations needed by each shot", "Generate alternatives and compare them before committing video spend", "Inspect every clip across time for morphing, anatomy, topology, flicker and contact", "Repair the smallest failing unit and keep the best passing candidate"],
    contracts: ["CharacterAndLocationConsistency", "TemporalAnatomy", "MotionInterest", "EditHandlesAndEndpoints"],
    touch: { status: "Automatic", label: "Autonomous production tunnel", copy: "The launch version does not expose a routine clip approval queue. The agent keeps regenerating or repairing inside policy.", trigger: "The optional Clip Lab shown in the alternate scope can be introduced later without changing the underlying asset graph." },
    viewer: { type: "custom", custom: "clips", title: "A generated shot is a candidate, not an answer", caption: "The system compares, rejects and repairs clips before the user ever sees the final timeline." }
  },
  {
    id: "F1", phase: "Future", phaseColor: "#b5772a", title: "Clip Lab · planned add-on", future: true,
    agent: "Human + Generation Agent", input: "Generated clip candidates", action: "Accept or redirect", output: "UserLockedClips",
    summary: "A later assisted mode can expose the pre-edit clip lineup without making it part of the launch workflow.",
    steps: ["Line clips up in intended edit order", "Accept or reject any clip", "Open its prompt and reference images in a focused modal", "Edit, regenerate or replace only that clip and reconform downstream dependencies"],
    contracts: ["ClipRevisionLineage", "ReferenceVisibility", "LocalRegeneration", "DownstreamReconcile"],
    touch: { status: "Future", label: "Planned optional intervention", copy: "This is for users who want directorial control before the edit. It is deliberately off in the launch flow.", trigger: "Enabling assisted mode changes the product's interaction cost, not the quality contract or generation architecture." },
    viewer: { type: "custom", custom: "clipLab", title: "An NLE feeling without becoming an NLE", caption: "The interaction is a tactile filmstrip: inspect, accept, redirect—then let the agent rebuild the cut." }
  },
  {
    id: "07", phase: "Autopilot", phaseColor: "#397487", title: "Score, edit, QC & repair",
    agent: "Audio, Edit & QC Agents", input: "Accepted clips + audio", action: "Finish & challenge", output: "PassingMaster",
    summary: "Voice, score, SFX, foley, ambience, silence, grade, captions and edit become one film, then an independent jury tries to disprove its quality.",
    steps: ["Arrange a continuous score and sound world against the master clock", "Conform the deterministic edit, grade, captions and final mix", "Search for story, identity, visual, motion, audio and cultural defects", "Route local repairs and re-check every affected dependency"],
    contracts: ["VoiceAndMix", "CinematicUnity", "ZeroCriticalDefects", "EvidenceConfidence"],
    touch: { status: "Automatic", label: "Autonomous production tunnel", copy: "There is no Gate B, flagged-shot queue or Gate C in the launch experience. Quality checks become machine contracts and repair loops.", trigger: "The agent may fail closed, but it never lowers a hidden quality floor just to finish within budget." },
    viewer: { type: "gallery", title: "QC protects belief, not merely correctness", caption: "The jury looks for glitches and also asks whether the episode is emotionally convincing, engaging, coherent and cinematic.", images: [
      { label: "Identity drift", src: "assets/character-drift.png", alt: "Two shots showing character identity drift", position: "center center", badge: "REJECT · identity changes across the cut", tone: "fail" },
      { label: "Motion defect", src: "assets/motion-defect.png", alt: "Sequential frames showing a temporal hand defect", position: "center center", badge: "REJECT · hand geometry mutates", tone: "fail" },
      { label: "Passing master", src: "assets/final-frame.png", alt: "A polished cinematic devotional drama frame", position: "center 42%", badge: "PASS · coherent final candidate", tone: "pass" }
    ] }
  },
  {
    id: "08", phase: "Review", phaseColor: "#7a3f55", title: "Review the final video",
    agent: "User + QC & Release Agent", input: "PassingMaster", action: "Watch & decide", output: "ApprovedMaster",
    summary: "The next thing the user reviews after locking the cast and locations is the finished video—not the machinery in between.",
    steps: ["Present the vertical master in a distraction-free cinema review surface", "Show a concise quality and provenance summary on demand", "Accept the final or request a targeted rerun with timecoded direction", "Preserve every revision so the accepted cut is fully attributable"],
    contracts: ["PassingReleaseDecision", "RevisionLineage", "TimecodedDirection", "FinalUserApproval"],
    touch: { status: "Required", label: "Human decision 4 of 4", copy: "The user watches the completed film and accepts it—or gives focused direction for a new passing revision.", trigger: "This is the only routine episode review after the initial visual world has been locked." },
    viewer: { type: "custom", custom: "final", title: "Review a film, not a dashboard", caption: "Controls recede; the vertical episode dominates. Technical evidence is available without competing with the emotional experience." }
  },
  {
    id: "09", phase: "Deliver", phaseColor: "#33705c", title: "Package & publish",
    agent: "QC & Release Agent", input: "ApprovedMaster", action: "Attest & deliver", output: "EpisodePackage",
    summary: "The accepted revision becomes a signed master, editable timeline, complete production bundle and—when enabled—an idempotently published episode.",
    steps: ["Export 1080×1920 master, captions and promotable moments", "Emit OTIO and FCP7 XML with all audio stems", "Package raw clips, prompts, references, QC, cost and provenance", "Publish through a channel adapter only when organization policy enables it"],
    contracts: ["PackageCompleteness", "TimelineRoundTrip", "ProvenanceAccuracy", "IdempotentPublish"],
    touch: { status: "Automatic", label: "Agent-owned delivery", copy: "Packaging is automatic after final approval. Publish permission is an organization-level policy, not a repeated creative gate.", trigger: "Export-only remains safe by default until Zyra enables direct publishing." },
    viewer: { type: "custom", custom: "delivery", title: "The viewer gets the film; Zyra keeps the whole production", caption: "Every final pixel remains editable, auditable and reproducible." }
  }
];

const keyInventory = {
  present: [
    { name: "ANTHROPIC_API_KEY", purpose: "Director / crew reasoning lane", state: "Present" },
    { name: "FAL_KEY", purpose: "Image, video, upscaling and media models", state: "Present" },
    { name: "GOOGLE_GENAI_API_KEY", purpose: "Gemini VLM QC + image/TTS bake-offs", state: "Present" },
    { name: "OPENAI_API_KEY", purpose: "Independent judge + Whisper ASR", state: "Rotate", tone: "warning" }
  ],
  needed: [
    { name: "ELEVENLABS_API_KEY", purpose: "Primary expressive voice, alignment, SFX", state: "Needed" },
    { name: "SARVAM_API_KEY", purpose: "Hindi bake-off + regional voice lane", state: "Needed" },
    { name: "NEXT_PUBLIC_SUPABASE_URL", purpose: "Database / auth / storage endpoint", state: "Needed" },
    { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", purpose: "Browser-safe Supabase access", state: "Needed" },
    { name: "SUPABASE_SERVICE_ROLE_KEY", purpose: "Server-side production data access", state: "Needed" },
    { name: "TRIGGER_SECRET_KEY", purpose: "Durable workflow runner", state: "Needed" },
    { name: "CRON_SECRET", purpose: "Scheduled monitor authentication", state: "Needed" },
    { name: "SENTRY_DSN", purpose: "Server-side error telemetry", state: "Needed" },
    { name: "NEXT_PUBLIC_SENTRY_DSN", purpose: "Client-side error telemetry", state: "Needed" },
    { name: "C2PA_SIGNING_KEY + CERT", purpose: "Provenance signing; secret names to define", state: "Define" }
  ],
  optional: [
    { name: "GROQ_API_KEY", purpose: "Optional fast Whisper reconciliation", state: "Optional" },
    { name: "KLING_ACCESS_KEY", purpose: "Direct Kling cost-optimization lane", state: "Later" },
    { name: "KLING_SECRET_KEY", purpose: "Direct Kling cost-optimization lane", state: "Later" },
    { name: "YOUTUBE_CLIENT_ID", purpose: "Direct scheduled publish + analytics", state: "Later" },
    { name: "YOUTUBE_CLIENT_SECRET", purpose: "YouTube OAuth server secret", state: "Later" }
  ]
};

let activeStage = 0;
let scope = "launch";
let activeFamily = "Indian Mythology";
let lookQuery = "";
let bwOnly = false;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);

function getStages() {
  return scope === "future" ? stages : stages.filter((stage) => !stage.future);
}

function styleTailFor(look = selectedLook) {
  if (customStyleTail && look.id === selectedLook.id) return customStyleTail;
  if (look.id === DEFAULT_LOOK_ID) {
    return "Prestige Indian mythological realism with sculpted natural faces, reverent scale and restrained divine radiance. Warm antique-gold practicals meet deep indigo shadows; tactile silk, carved stone and weathered metal retain fine material detail. Cinematic large-format depth, soft highlight bloom, subtle atmospheric volume, controlled saturation and dignified iconographic framing—never plastic skin, costume-pageant gloss or generic fantasy spectacle.";
  }
  return `${look.feel}. Carry this look consistently through camera character, light quality, palette, material texture, contrast, depth and finishing. Preserve natural faces, believable surfaces and a cohesive cinematic grade; avoid plastic skin, generic digital gloss, text, logos and watermark.`;
}

function renderStageList() {
  const active = getStages();
  $("#stage-list").innerHTML = active.map((stage, index) => {
    const human = ["Required", "Future"].includes(stage.touch.status);
    return `<button class="stage-button${index === activeStage ? " is-active" : ""}${human ? " has-human" : ""}" type="button" data-stage="${index}" aria-current="${index === activeStage ? "step" : "false"}">
      <b>${stage.id}</b><span>${stage.title}</span><small aria-label="${human ? "Human touchpoint" : "Automated stage"}"></small>
    </button>`;
  }).join("");
  $$(".stage-button").forEach((button) => button.addEventListener("click", () => setStage(Number(button.dataset.stage))));
}

function listMarkup(items) {
  return items.map((item) => `<li>${item}</li>`).join("");
}

function schemaMarkup(nodes) {
  return `<div class="schematic-content">${nodes.map((node, index) => `${index ? '<div class="schema-line"></div>' : ""}<div class="schema-node"><span>${node[0]}</span><div><strong>${node[1]}</strong><small>${node[2]}</small></div></div>`).join("")}</div>`;
}

function setImage(image) {
  const img = $("#viewer-image");
  const schematic = $("#viewer-schematic");
  img.hidden = false;
  schematic.hidden = true;
  img.src = image.src;
  img.alt = image.alt;
  img.style.objectPosition = image.position || "center center";
  img.animate?.([{ opacity: .45, transform: "scale(1.015)" }, { opacity: 1, transform: "scale(1)" }], { duration: 350, easing: "ease-out" });
}

function scriptDemo() {
  return `<div class="product-surface script-surface">
    <div class="surface-bar"><span class="live-dot"></span><strong>episode_07.script</strong><small>SHA-256 locked</small></div>
    <div class="script-columns">
      <div class="script-page"><span>USER SCRIPT · READ ONLY</span><pre>SCENE 12 · PALACE CORRIDOR · NIGHT

VEER turns to ACHARYA.

VEER
“If victory costs my dharma,
what have I truly won?”

ACHARYA holds his gaze.</pre><i>No words changed</i></div>
      <div class="sidecar"><span>AI PRODUCTION SIDECAR</span><div><b>Speaker</b><small>VEER → ACHARYA</small></div><div><b>Performance</b><small>quiet doubt · measured pace</small></div><div><b>Pronunciation</b><small>dharma · /d̪ʱər.mə/</small></div><div><b>Coverage</b><small>medium → reaction close-up</small></div></div>
    </div>
  </div>`;
}

function lookDemo() {
  const tail = styleTailFor();
  return `<div class="product-surface look-surface">
    <div class="look-hero-mini">
      <img src="assets/looks/${escapeHtml(selectedLook.id)}.webp" alt="${escapeHtml(selectedLook.name)} look reference">
      <div><span>${escapeHtml(selectedLook.family)} · default</span><h4>${escapeHtml(selectedLook.name)}</h4><p>${escapeHtml(selectedLook.feel)}</p><button id="open-look-picker" type="button">Explore all 117 looks <b>↗</b></button></div>
    </div>
    <details class="look-dna"><summary><span>Inspect generated look DNA</span><small>Block 2 · automatic</small></summary><textarea id="inline-tail" aria-label="Generated style tail">${escapeHtml(tail)}</textarea><div><small>Appended verbatim after every scene prompt</small><button id="save-inline-tail" type="button">Save DNA</button></div></details>
  </div>`;
}

function assetCard(id, kind, name, image, prompt) {
  return `<article class="asset-card" data-asset="${id}">
    <div class="asset-image"><img src="${image}" alt="Generated ${escapeHtml(kind)} option for ${escapeHtml(name)}"><span>${escapeHtml(kind)}</span></div>
    <div class="asset-meta"><strong>${escapeHtml(name)}</strong><small>Generated in ${escapeHtml(selectedLook.name)}</small></div>
    <div class="asset-actions"><button type="button" data-asset-action="accept">Accept</button><button type="button" data-asset-action="edit">Edit prompt</button><button type="button" data-asset-action="upload">Upload</button></div>
    <input type="file" accept="image/*" hidden>
    <div class="asset-editor" hidden><label>Subject / location prompt<textarea>${escapeHtml(prompt)}</textarea></label><div class="tail-lock"><b>LOOK DNA · LOCKED</b><p>${escapeHtml(styleTailFor())}</p></div><button type="button" data-asset-action="regenerate">Regenerate option</button></div>
  </article>`;
}

function assetsDemo() {
  return `<div class="product-surface asset-studio">
    <div class="studio-head"><div><span>WORLD STUDIO</span><strong>3 assets need your eye</strong></div><small>Accept · redirect · replace</small></div>
    <div class="asset-scroll">
      ${assetCard("veer", "Character", "Veer", "assets/final-frame.png", "A clean front-facing portrait of VEER, a young epic prince with a thoughtful gaze, athletic build, long dark hair and period-inspired crimson garments. Neutral expression, plain studio backdrop, no props.")}
      ${assetCard("matriarch", "Character", "The Matriarch", "assets/emotional-performance.png", "A clean front-facing portrait of THE MATRIARCH, a dignified adult Indian royal woman with a steady gaze, deep maroon sari and restrained antique-gold jewellery. Neutral studio reference, no scene action.")}
      ${assetCard("riverbank", "Location", "Sacred Riverbank", "assets/looks/lamplit-temple-stillness.webp", "A wide empty establishing shot of an ancient Indian riverbank at dawn: weathered stone ghats, distant temple silhouettes, reeds, light mist and a clear spatial layout. No people.")}
    </div>
  </div>`;
}

function sheetsDemo() {
  const image = "assets/emotional-performance.png";
  const views = [["Front","50% 24%"],["Left profile","38% 24%"],["Right profile","62% 24%"],["Rear","50% 12%"],["Close-up","50% 18%"]];
  return `<div class="product-surface sheet-surface"><div class="sheet-head"><span>IDENTITY SHEET · AUTO-CREATED</span><strong>The Matriarch</strong><small>${escapeHtml(selectedLook.name)} · 16:9 composite</small></div><div class="sheet-views">${views.map(([label,pos]) => `<figure><img src="${image}" alt="${label} identity view" style="object-position:${pos}"><figcaption>${label}</figcaption></figure>`).join("")}</div><div class="sheet-pass"><i>✓</i><span><strong>Identity contract passed</strong><small>face · hair · build · wardrobe · proportions</small></span></div></div>`;
}

function planningDemo() {
  return `<div class="product-surface prompt-surface"><div class="prompt-lock"><span>IMMUTABLE</span><strong>Script revision 07</strong><small>dialogue · speakers · actions</small></div><div class="prompt-plus">+</div><div class="prompt-block"><span>BLOCK 1 · SHOT SPECIFIC</span><p>Medium close-up of VEER turning toward ACHARYA in the rain-darkened palace corridor, oil lamps receding behind him; restrained doubt in his eyes, shallow natural depth of field.</p></div><div class="prompt-plus">+</div><div class="prompt-block tail"><span>BLOCK 2 · LOCKED LOOK</span><p>${escapeHtml(styleTailFor())}</p></div><div class="prompt-result"><span></span><strong>Audio master + edit plan + generation prompts</strong></div></div>`;
}

function clipsDemo() {
  const clips = [
    ["assets/emotional-performance.png","Shot 04","Performance"],
    ["assets/final-frame.png","Shot 11","Moral turn"],
    ["assets/motion-defect.png","Candidate rejected","Temporal QC"]
  ];
  return `<div class="product-surface clip-surface"><div class="clip-head"><span>AUTONOMOUS SELECT</span><strong>18 accepted · 31 rejected · 4 repaired</strong></div><div class="clip-reel">${clips.map(([src,title,label],i)=>`<figure class="${i===2?'rejected':''}"><div><img src="${src}" alt="${escapeHtml(title)}"><i>${i===2?'×':'✓'}</i></div><figcaption><strong>${title}</strong><small>${label}</small></figcaption></figure>`).join("")}</div><div class="repair-beam"><span></span><p>candidate → detectors → pairwise judge → repair → accepted clip</p></div></div>`;
}

function clipLabDemo() {
  return `<div class="product-surface clip-lab"><div class="clip-lab-head"><div><span>PLANNED · ASSISTED MODE</span><strong>Scene 03 · the vow</strong></div><small>6 clips · 00:27</small></div><div class="timeline-strip">${["emotional-performance.png","final-frame.png","character-drift.png","motion-defect.png"].map((src,i)=>`<button type="button" class="${i===1?'selected':''}"><img src="assets/${src}" alt="Clip ${i+1}"><span>0${i+1}</span></button>`).join("")}</div><div class="clip-command"><div><span>SHOT 05 · 4.2s</span><strong>Veer lowers the bow</strong><small>3 references · prompt available</small></div><div><button type="button">Accept</button><button type="button">Edit prompt</button><button type="button">Regenerate</button></div></div></div>`;
}

function finalDemo() {
  return `<div class="product-surface final-surface"><div id="final-player" class="final-player"><img src="assets/final-frame.png" alt="Finished vertical devotional drama"><button id="play-demo" type="button" aria-label="Play final video"><span>▶</span></button><div class="final-top"><span>EPISODE 07 · FINAL CANDIDATE</span><small>01:22</small></div><div class="final-progress"><i></i></div></div><div class="final-actions"><button id="accept-final" type="button" class="accept-final">Accept final</button><button id="rerun-final" type="button">Request targeted rerun</button></div><p id="final-feedback">QC passed · 0 critical defects · Hindi captions · provenance ready</p></div>`;
}

function deliveryDemo() {
  return `<div class="product-surface delivery-surface"><div class="delivery-orbit"><div class="delivery-core"><span>FINAL</span><strong>episode_07.mp4</strong><small>1080 × 1920 · 30fps</small></div>${[["EDIT","OTIO + XML"],["STEMS","VO · score · SFX"],["BUNDLE","clips · prompts · refs"],["TRUST","QC · cost · C2PA"]].map(([a,b],i)=>`<div class="orbit-item orbit-${i+1}"><span>${a}</span><strong>${b}</strong></div>`).join("")}</div></div>`;
}

function customDemo(name) {
  return ({ script: scriptDemo, look: lookDemo, assets: assetsDemo, sheets: sheetsDemo, planning: planningDemo, clips: clipsDemo, clipLab: clipLabDemo, final: finalDemo, delivery: deliveryDemo }[name] || deliveryDemo)();
}

function renderViewer(viewer) {
  const img = $("#viewer-image");
  const schematic = $("#viewer-schematic");
  const gallery = $("#viewer-gallery");
  const frame = $("#viewer-frame");
  const frameUi = $(".frame-ui", frame);
  gallery.hidden = true;
  gallery.innerHTML = "";
  frame.classList.toggle("is-product", viewer.type === "custom");
  frameUi.hidden = viewer.type === "custom";
  $("#viewer-title").textContent = viewer.title;
  $("#viewer-caption").textContent = viewer.caption;
  const badge = $("#viewer-badge");
  badge.hidden = viewer.type === "custom";

  if (viewer.type === "custom") {
    img.hidden = true;
    schematic.hidden = false;
    schematic.innerHTML = customDemo(viewer.custom);
    wireCustomDemo(viewer.custom);
  } else if (viewer.type === "gallery") {
    schematic.hidden = true;
    const first = viewer.images[0];
    setImage(first);
    badge.hidden = false;
    badge.textContent = first.badge;
    badge.className = `viewer-badge ${first.tone}`;
    gallery.hidden = false;
    gallery.innerHTML = viewer.images.map((image, index) => `<button type="button" class="${index === 0 ? "is-active" : ""}" data-image="${index}">${image.label}</button>`).join("");
    gallery.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
      gallery.querySelectorAll("button").forEach((item) => item.classList.toggle("is-active", item === button));
      const image = viewer.images[Number(button.dataset.image)];
      setImage(image);
      badge.textContent = image.badge;
      badge.className = `viewer-badge ${image.tone}`;
    }));
  }
}

function wireCustomDemo(name) {
  if (name === "look") {
    $("#open-look-picker")?.addEventListener("click", openLookModal);
    $("#save-inline-tail")?.addEventListener("click", (event) => {
      customStyleTail = $("#inline-tail").value.trim();
      event.currentTarget.textContent = "Saved ✓";
    });
  }
  if (name === "assets") wireAssetStudio();
  if (name === "final") {
    $("#play-demo")?.addEventListener("click", () => {
      const player = $("#final-player");
      player.classList.toggle("is-playing");
      $("#play-demo span").textContent = player.classList.contains("is-playing") ? "Ⅱ" : "▶";
    });
    $("#accept-final")?.addEventListener("click", (event) => {
      event.currentTarget.textContent = "Accepted ✓";
      event.currentTarget.classList.add("is-done");
      $("#final-feedback").textContent = "Final revision accepted · delivery package is now being signed";
    });
    $("#rerun-final")?.addEventListener("click", () => {
      $("#final-feedback").textContent = "Direction mode opened · add one timecoded note and regenerate only the affected span";
    });
  }
}

function wireAssetStudio() {
  $$("[data-asset-action]").forEach((button) => button.addEventListener("click", () => {
    const card = button.closest(".asset-card");
    const action = button.dataset.assetAction;
    if (action === "accept") {
      card.classList.toggle("is-locked");
      button.textContent = card.classList.contains("is-locked") ? "Locked ✓" : "Accept";
    }
    if (action === "edit") {
      const editor = $(".asset-editor", card);
      editor.hidden = !editor.hidden;
      button.textContent = editor.hidden ? "Edit prompt" : "Close prompt";
    }
    if (action === "upload") $("input[type=file]", card).click();
    if (action === "regenerate") {
      card.classList.add("is-regenerating");
      button.textContent = "Regenerating…";
      setTimeout(() => {
        card.classList.remove("is-regenerating");
        card.classList.remove("is-locked");
        button.textContent = "New option ready ✓";
        $(".asset-meta small", card).textContent = "Prompt revision 02 · ready to accept";
      }, 850);
    }
  }));
  $$(".asset-card input[type=file]").forEach((input) => input.addEventListener("change", () => {
    if (!input.files?.[0]) return;
    const card = input.closest(".asset-card");
    card.classList.add("is-locked");
    $(".asset-meta small", card).textContent = `${input.files[0].name} · uploaded anchor`;
    $("[data-asset-action=accept]", card).textContent = "Locked ✓";
  }));
}

function renderTouch(stage) {
  const card = $("#intervention-card");
  const status = $("#intervention-status");
  const required = stage.touch.status === "Required";
  const future = stage.touch.status === "Future";
  card.classList.toggle("baseline", required || future);
  status.textContent = stage.touch.label;
  status.className = `intervention-status ${required ? "required" : future ? "conditional" : ""}`;
  $("#intervention-title").textContent = required ? "Intentional human touchpoint" : future ? "Optional future touchpoint" : "Agent-owned stage";
  $("#intervention-copy").textContent = stage.touch.copy;
  $("#intervention-trigger").textContent = stage.touch.trigger;
}

function renderStage() {
  const active = getStages();
  if (activeStage >= active.length) activeStage = active.length - 1;
  const stage = active[activeStage];
  $("#stage-id").textContent = stage.id;
  $("#stage-phase").textContent = stage.phase;
  $("#stage-agent").textContent = stage.agent;
  $("#stage-title").textContent = stage.title;
  $("#stage-summary").textContent = stage.summary;
  $("#stage-input").textContent = stage.input;
  $("#stage-action").textContent = stage.action;
  $("#stage-output").textContent = stage.output;
  $("#stage-steps").innerHTML = listMarkup(stage.steps);
  $("#stage-contracts").innerHTML = listMarkup(stage.contracts);
  $("#rail-progress").textContent = `${String(activeStage + 1).padStart(2, "0")} / ${String(active.length).padStart(2, "0")}`;
  $("#progress-fill").style.width = `${((activeStage + 1) / active.length) * 100}%`;
  $("#frame-time").textContent = String(Math.min(99, activeStage * 9)).padStart(2, "0");
  $("#prev-stage").disabled = activeStage === 0;
  $("#next-stage").innerHTML = activeStage === active.length - 1 ? "Restart <span aria-hidden=\"true\">↺</span>" : "Next stage <span aria-hidden=\"true\">→</span>";
  renderViewer(stage.viewer);
  renderTouch(stage);
  renderStageList();
  renderSystemMap();
}

function setStage(index) {
  activeStage = Math.max(0, Math.min(getStages().length - 1, index));
  renderStage();
}

function renderSystemMap() {
  const active = getStages();
  $("#system-map").innerHTML = active.map((stage) => `<div class="map-stage" style="--stage-color:${stage.phaseColor}"><b>${stage.id} · ${stage.phase}</b><span>${stage.title}</span></div>`).join("");
  $("#map-summary").textContent = `${active.length} stages · ${scope === "future" ? "5" : "4"} human decisions · ${scope === "future" ? "assisted clip lab" : "one autonomous production tunnel"}`;
}

function renderKeys(group, target) {
  $(target).innerHTML = group.map((key) => `<div class="key-row"><code>${key.name}</code><span>${key.purpose}</span><small class="${key.tone || ""}">${key.state}</small></div>`).join("");
}

function selectTab(tabId) {
  const flowSelected = tabId === "tab-flow";
  $("#tab-flow").classList.toggle("is-active", flowSelected);
  $("#tab-tech").classList.toggle("is-active", !flowSelected);
  $("#tab-flow").setAttribute("aria-selected", String(flowSelected));
  $("#tab-tech").setAttribute("aria-selected", String(!flowSelected));
  $("#tab-flow").tabIndex = flowSelected ? 0 : -1;
  $("#tab-tech").tabIndex = flowSelected ? -1 : 0;
  $("#panel-flow").hidden = !flowSelected;
  $("#panel-tech").hidden = flowSelected;
}

function isBlackAndWhite(look) {
  return /noir|monochrome|black-?and-?white|b&w|silver|ink|sumi|charcoal/i.test(`${look.name} ${look.feel}`);
}

function openLookModal() {
  activeFamily = "Indian Mythology";
  lookQuery = "";
  bwOnly = false;
  $("#look-search").value = "";
  $("#look-bw").classList.remove("is-active");
  $("#look-bw").setAttribute("aria-pressed", "false");
  $("#look-modal").hidden = false;
  document.body.classList.add("modal-open");
  renderLookLibrary();
  $("#look-search").focus();
}

function closeLookModal() {
  $("#look-modal").hidden = true;
  document.body.classList.remove("modal-open");
}

function renderLookLibrary() {
  const families = [...new Set(looks.map((look) => look.family))];
  $("#look-families").innerHTML = families.map((family) => `<button type="button" role="tab" aria-selected="${family === activeFamily}" class="${family === activeFamily ? "is-active" : ""}" data-family="${escapeHtml(family)}">${escapeHtml(family)} <small>${looks.filter((look) => look.family === family).length}</small></button>`).join("");
  $$("[data-family]", $("#look-families")).forEach((button) => button.addEventListener("click", () => {
    activeFamily = button.dataset.family;
    renderLookLibrary();
  }));
  const q = lookQuery.trim().toLowerCase();
  const filtered = looks.filter((look) => look.family === activeFamily && (!bwOnly || isBlackAndWhite(look)) && (!q || `${look.name} ${look.feel}`.toLowerCase().includes(q)));
  $("#look-count").textContent = `${filtered.length} look${filtered.length === 1 ? "" : "s"}`;
  $("#look-grid").innerHTML = filtered.length ? filtered.map((look) => `<button type="button" class="look-tile${look.id === selectedLook.id ? " is-selected" : ""}" data-look="${look.id}"><div><img src="assets/looks/${look.id}.webp" alt="${escapeHtml(look.name)}" loading="lazy"><span>✓</span></div><strong>${escapeHtml(look.name)}</strong><small>${escapeHtml(look.feel)}</small></button>`).join("") : `<p class="look-empty">No looks match. Try another search or family.</p>`;
  $$("[data-look]", $("#look-grid")).forEach((button) => button.addEventListener("click", () => {
    selectedLook = looks.find((look) => look.id === button.dataset.look) || selectedLook;
    customStyleTail = "";
    renderLookLibrary();
  }));
  $("#look-inspector-image").src = `assets/looks/${selectedLook.id}.webp`;
  $("#look-inspector-image").alt = `${selectedLook.name} selected look`;
  $("#look-inspector-name").textContent = selectedLook.name;
  $("#look-inspector-feel").textContent = selectedLook.feel;
  $("#look-inspector-tail").textContent = styleTailFor(selectedLook);
}

$("#tab-flow").addEventListener("click", () => selectTab("tab-flow"));
$("#tab-tech").addEventListener("click", () => selectTab("tab-tech"));
$$('[role="tab"]').forEach((tab) => tab.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key) || tab.closest("#look-families")) return;
  event.preventDefault();
  const next = tab.id === "tab-flow" ? $("#tab-tech") : $("#tab-flow");
  selectTab(next.id);
  next.focus();
}));

$$('[data-scope]').forEach((button) => button.addEventListener("click", () => {
  scope = button.dataset.scope;
  activeStage = 0;
  $$('[data-scope]').forEach((item) => {
    const selected = item === button;
    item.classList.toggle("is-active", selected);
    item.setAttribute("aria-pressed", String(selected));
  });
  renderStage();
}));

$("#prev-stage").addEventListener("click", () => setStage(activeStage - 1));
$("#next-stage").addEventListener("click", () => setStage(activeStage === getStages().length - 1 ? 0 : activeStage + 1));

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("#look-modal").hidden) { closeLookModal(); return; }
  if ($("#panel-flow").hidden || !$("#look-modal").hidden || ["INPUT", "TEXTAREA", "BUTTON", "SUMMARY"].includes(document.activeElement?.tagName)) return;
  if (event.key === "ArrowLeft") setStage(activeStage - 1);
  if (event.key === "ArrowRight") setStage(activeStage + 1);
});

$$('[data-close-look]').forEach((button) => button.addEventListener("click", closeLookModal));
$("#look-search").addEventListener("input", (event) => { lookQuery = event.target.value; renderLookLibrary(); });
$("#look-bw").addEventListener("click", (event) => {
  bwOnly = !bwOnly;
  event.currentTarget.classList.toggle("is-active", bwOnly);
  event.currentTarget.setAttribute("aria-pressed", String(bwOnly));
  renderLookLibrary();
});
$("#use-look").addEventListener("click", () => { closeLookModal(); renderStage(); });

renderKeys(keyInventory.present, "#keys-present");
renderKeys(keyInventory.needed, "#keys-needed");
renderKeys(keyInventory.optional, "#keys-optional");
renderStage();
