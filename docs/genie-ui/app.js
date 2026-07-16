const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const scrollBehavior = () => reducedMotion.matches ? "auto" : "smooth";

const stageOrder = ["script", "voice", "look", "world", "create", "premiere"];
let currentWorkspaceView = "home";
let currentStage = "script";
let selectedVoice = "male";
let selectedLook = "glowing-divine-realism";
let highestUnlocked = 0;
let scriptLocked = false;
let activeAsset = null;
let productionTimer = null;
let productionProgress = 0;
let productionState = "idle";
let playbackTimer = null;
let playbackFrame = 0;
let toastTimer = null;
let returnFocus = null;
let vaultQuery = "";
let vaultLimit = 24;
let repairNoteSequence = 3;
let repairPlaybackTimer = null;
let worldAuthorizationDecision = "pending";
let worldAuthorizationRecorded = false;
let performanceVersion = 1;
let culturalApprovalRecorded = false;
const completedStages = new Set();
const episodeAggregates = {
  neelkanth01: { series: "Neelkanth", number: "01", title: "The Poison of the Ocean", id: "EP-NEE-01", release: "04", config: "07", job: "No paid job enqueued" },
  neelkanth02: { series: "Neelkanth", number: "02", title: "The Descent of Ganga", id: "EP-NEE-02", release: "04", config: "01", job: "No paid job enqueued" },
  neelkanth03: { series: "Neelkanth", number: "03", title: "When the Third Eye Opened", id: "EP-NEE-03", release: "03", config: "05", job: "JOB-NEE-03-PROD · running" },
  durga02: { series: "Durga Saptashati", number: "02", title: "Mahishasura’s Last Stand", id: "EP-DUR-02", release: "02", config: "04", job: "JOB-DUR-02-PROD · running" },
  krishna08: { series: "Krishna Leelas", number: "08", title: "The Govardhan Promise", id: "EP-KRI-08", release: "06", config: "02", job: "No paid job enqueued" },
  ramayana06: { series: "Ramayana", number: "06", title: "Hanuman Crosses the Ocean", id: "EP-RAM-06", release: "05", config: "03", job: "JOB-RAM-06-QC · running" },
};
let activeEpisodeKey = "neelkanth01";
let repairNotes = [
  {
    id: 1,
    start: "00:18.4",
    end: "00:22.1",
    text: "Shiva’s rudraksha beads change shape during the camera move. Keep them identical to the approved character reference. Do not change his face or the camera direction.",
  },
  {
    id: 2,
    start: "00:41.0",
    end: "00:44.5",
    text: "The score is overpowering the narrator here. Keep every spoken word and the same emotional performance, but let the voice sit clearly above the music.",
  },
];

const defaultAssetPrompts = {
  shiva: "Calm, compassionate and immeasurably powerful. Blue-grey complexion, matted locks, crescent moon, rudraksha and trishul. Symmetrical identity portrait, steady gaze, no scene action.",
  parvati: "Goddess Parvati with steady compassion and protective warmth. Restrained royal ornament, red silk, Himalayan setting, clear identity portrait, no scene action.",
  kailash: "The sacred Himalayan realm of Mount Kailash. Snowlight, immense scale, stone pathways and devotional stillness. Repeatable master environment with no modern structures.",
};
let assetPrompts = { ...defaultAssetPrompts };

const featuredLooks = [
  { id: "glowing-divine-realism", name: "Glowing Divine Realism", feel: "Sacred radiance, cinematic faces and devotional grandeur." },
  { id: "lamplit-temple-stillness", name: "Lamplit Temple Stillness", feel: "Quiet ritual, ancient stone and intimate pools of living light." },
  { id: "divine-fury", name: "Divine Fury", feel: "Mythic scale, storm energy and operatic celestial action." },
  { id: "devotional-temple-gold", name: "Devotional Temple Gold", feel: "Warm sacred interiors, flame, incense and tactile reverence." },
  { id: "mythic-molten-copper-epic", name: "Molten Copper Epic", feel: "Burnished metals, monumental shadow and ancient-war intensity." },
  { id: "golden-fantasy-epic", name: "Golden Fantasy Epic", feel: "Grand landscapes, heroic silhouettes and luminous spectacle." },
  { id: "sacred-folk-scroll", name: "Sacred Folk Scroll", feel: "Handmade storytelling, symbolic space and devotional folk texture." },
  { id: "temple-wall-fresco", name: "Temple-Wall Fresco", feel: "Weathered pigment, carved rhythm and history brought gently alive." },
  { id: "devotional-calendar-art", name: "Devotional Calendar Art", feel: "Iconic divine clarity and saturated traditional colour." },
  { id: "indian-mythology-comic", name: "Indian Mythology Comic", feel: "Graphic storytelling, bold gesture and crisp dramatic staging." },
  { id: "bright-indian-tv-cartoon", name: "Bright Indian TV Cartoon", feel: "Friendly shapes, energetic colour and accessible family storytelling." },
  { id: "antique-ink-chronicle", name: "Antique Ink Chronicle", feel: "Historic linework, parchment atmosphere and restrained motion." },
  { id: "opulent-royal-period-jewel-tone", name: "Royal Jewel Tone", feel: "Velvet shadow, gemstone colour and royal-period abundance." },
  { id: "moonlit-day-for-night-blue", name: "Moonlit Sacred Blue", feel: "Silver-blue night, quiet mystery and sculptural silhouettes." },
  { id: "dust-and-smoke-godray-interior", name: "Godray Interior", feel: "Dust, smoke and shafts of light shaped like divine intervention." },
  { id: "top-down-aerial-epic", name: "Aerial Epic", feel: "Sacred geography, processions and monumental top-down scale." }
];

const detailedFeel = new Map(featuredLooks.map((look) => [look.id, look.feel]));
const sourceLooks = Array.isArray(window.ZYRA_LOOKS) ? window.ZYRA_LOOKS : featuredLooks;
const featuredIds = new Set(featuredLooks.map((look) => look.id));
const lookOptions = [
  ...featuredLooks.map((look) => ({
    ...sourceLooks.find((item) => item.id === look.id),
    ...look,
  })),
  ...sourceLooks
    .filter((look) => !featuredIds.has(look.id))
    .map((look) => ({
      ...look,
      feel: detailedFeel.get(look.id) || look.feel,
    })),
];

const shots = [
  { title: "The ocean churns", model: "Seedance", image: "divine-fury.webp" },
  { title: "Poison rises", model: "Seedance", image: "mythic-molten-copper-epic.webp" },
  { title: "The worlds recoil", model: "Kling 3.0", image: "golden-fantasy-epic.webp" },
  { title: "Shiva receives it", model: "Kling 2.5", image: "glowing-divine-realism.webp" },
  { title: "Parvati intervenes", model: "Kling 2.5", image: "devotional-temple-gold.webp" },
  { title: "The blue throat", model: "Kling 3.0", image: "moonlit-day-for-night-blue.webp" },
  { title: "Neelkanth revealed", model: "Seedance", image: "glowing-divine-realism.webp" }
];

const stageMessages = {
  script: "I’m protecting every word you enter. Production annotations will live beside the script, never inside it.",
  voice: "I will compare the spoken audio against the exact script and check Sanskrit pronunciation before any visual generation begins.",
  look: "This choice becomes a versioned Look Pack. It will govern colour, light, material, camera mood and visual consistency.",
  world: "I’m waiting for your taste. After acceptance, identity and environment reference packs will be generated and checked automatically.",
  create: "The crew is dormant. When you begin, I will evaluate every candidate against the launch rubrics and repair the smallest failing unit.",
  premiere: "Provisional automated QC passed. Qualified cultural review comes first; only that exact approved candidate can then enter separate creative/final review."
};

const workspaceMessages = {
  home: "I’m coordinating the whole studio. Active productions keep moving in the background; the Inbox only surfaces decisions that need human judgement.",
  series: "This Series Bible is the memory of the story world. New episodes inherit an approved release and pin it so later canon changes cannot silently alter production.",
  episode: "Living Cinema is the focused episode room. You can leave at any point without interrupting durable production work.",
};

function setWorkspaceView(view, shouldFocus = true) {
  if (!["home", "series", "episode"].includes(view)) return;
  currentWorkspaceView = view;
  $$("[data-workspace-view]").forEach((screen) => {
    const active = screen.dataset.workspaceView === view;
    screen.hidden = !active;
    screen.classList.toggle("is-active", active);
  });
  $$(".studio-nav [data-view]").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  $("#monica-current-stage").textContent = view === "episode"
    ? currentStage[0].toUpperCase() + currentStage.slice(1)
    : view === "home" ? "Studio Home" : "Series World";
  $("#monica-drawer-message").textContent = view === "episode" ? stageMessages[currentStage] : workspaceMessages[view];
  const heading = view === "home" ? $("#atrium-title") : view === "series" ? $("#series-title") : $(`[data-screen="${currentStage}"] h1`);
  $("#stage-announcer").textContent = `${heading?.textContent || view} opened`;
  if (shouldFocus && heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
  window.scrollTo({ top: 0, behavior: scrollBehavior() });
}

function primeEpisodeThrough(stage) {
  const targetIndex = stageIndex(stage);
  if (targetIndex < 0) return;
  if (targetIndex >= stageIndex("voice")) {
    scriptLocked = true;
    $("#script-input").readOnly = true;
    $("#lock-script").innerHTML = "Words locked <b>✓</b>";
    $("#unlock-script").hidden = false;
    $("#paste-script").hidden = true;
    $("#upload-script").hidden = true;
    completedStages.add("script");
  }
  if (targetIndex >= stageIndex("look")) completedStages.add("voice");
  if (targetIndex >= stageIndex("world")) completedStages.add("look");
  if (targetIndex >= stageIndex("create")) {
    $$(".world-asset").forEach((card) => {
      card.classList.add("is-accepted");
      $(".asset-state", card).textContent = "Identity anchor locked ✓";
      const acceptButton = $('[data-asset-action="accept"]', card);
      acceptButton.textContent = "Accepted ✓";
      acceptButton.setAttribute("aria-pressed", "true");
    });
    worldAuthorizationDecision = "authorize";
    worldAuthorizationRecorded = true;
    $("#authorize-range").checked = true;
    $("#budget-state").textContent = "Simulated · $40 hard ceiling · release 04";
    $("#start-production").disabled = false;
    $("#start-production").innerHTML = "<span>✦</span><strong>Begin autonomous production</strong><small>Atomic World Lock and simulated cost ceiling recorded</small>";
    $$('[name="world-decision"]').forEach((input) => { input.checked = input.value === "authorize"; });
    completedStages.add("world");
    updateWorldState();
  }
  highestUnlocked = Math.max(highestUnlocked, targetIndex);
  if (stage === "premiere") {
    productionState = "complete";
    productionProgress = 100;
    completedStages.add("create");
    $("#premiere-button").disabled = false;
  }
  refreshNavigation();
}

function selectEpisodeAggregate(key = "neelkanth01") {
  const episode = episodeAggregates[key] || episodeAggregates.neelkanth01;
  activeEpisodeKey = key in episodeAggregates ? key : "neelkanth01";
  $("#episode-series-link").textContent = `← ${episode.series}`;
  $("#episode-context-meta").textContent = `Episode ${episode.number} · Living Cinema`;
  $("#episode-context-title").textContent = episode.title;
  $("#episode-aggregate-id").textContent = episode.id;
  $("#episode-series-release").textContent = `${episode.release} · pinned`;
  $("#episode-config-revision").textContent = `Revision ${episode.config}`;
  $("#episode-job-state").textContent = episode.job;
  $("#episode-revision-state").textContent = episode.revision || "Draft revision";
  $("#episode-freshness-state").textContent = episode.freshness || "Current";
  $("#episode-freshness-state").classList.toggle("is-stale", /stale|invalid/i.test(episode.freshness || ""));
  $("#representative-flow-note").hidden = activeEpisodeKey === "neelkanth01";
}

function openEpisodeAt(stage = currentStage, episodeKey = activeEpisodeKey) {
  selectEpisodeAggregate(episodeKey);
  primeEpisodeThrough(stage);
  setWorkspaceView("episode", false);
  setStage(stage);
  closeWorkspacePanel(false);
}

function setSeriesTab(tab) {
  $$("[data-series-tab]").forEach((button) => {
    const active = button.dataset.seriesTab === tab;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  $$("[data-series-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.seriesPanel !== tab;
  });
  $("#stage-announcer").textContent = `${tab === "bible" ? "World Bible" : tab[0].toUpperCase() + tab.slice(1)} opened`;
}

function stageIndex(stage) {
  return stageOrder.indexOf(stage);
}

function isStageAvailable(stage) {
  return stageIndex(stage) <= highestUnlocked;
}

function refreshNavigation() {
  $$("[data-stage]").forEach((button) => {
    const stage = button.dataset.stage;
    const active = stage === currentStage;
    button.classList.toggle("is-active", active);
    button.classList.toggle("is-complete", completedStages.has(stage));
    button.disabled = !isStageAvailable(stage);
    button.setAttribute("aria-current", active ? "step" : "false");
  });
  $$("[data-command-stage]").forEach((button) => {
    button.disabled = !isStageAvailable(button.dataset.commandStage);
  });
}

function unlockThrough(stage) {
  highestUnlocked = Math.max(highestUnlocked, stageIndex(stage));
  refreshNavigation();
}

function completeStage(stage, nextStageName) {
  completedStages.add(stage);
  unlockThrough(nextStageName);
  setStage(nextStageName);
}

function invalidateFrom(stage) {
  const index = stageIndex(stage);
  stageOrder.slice(index).forEach((item) => completedStages.delete(item));
  highestUnlocked = Math.min(highestUnlocked, index);
  setEpisodeAggregateState({ job: "No paid job enqueued", freshness: `Stale after ${stage} revision`, revision: "Draft revision" });
  if (index <= stageIndex("world")) {
    worldAuthorizationDecision = "pending";
    worldAuthorizationRecorded = false;
    $$('[name="world-decision"]').forEach((input) => { input.checked = input.value === "pending"; });
    $$(".world-asset").forEach((card) => {
      card.classList.remove("is-accepted");
      $(".asset-state", card).textContent = "Awaiting your eye";
      const acceptButton = $('[data-asset-action="accept"]', card);
      acceptButton.textContent = "Accept";
      acceptButton.setAttribute("aria-pressed", "false");
    });
    updateWorldState();
  }
  if (index <= stageIndex("create")) resetProduction();
  refreshNavigation();
}

function invalidateProductionOnly() {
  completedStages.delete("create");
  completedStages.delete("premiere");
  highestUnlocked = completedStages.has("world") ? stageIndex("create") : Math.min(highestUnlocked, stageIndex("world"));
  setEpisodeAggregateState({ job: "No paid job enqueued", freshness: "Stale after performance/config revision", revision: "Draft revision" });
  resetProduction();
  refreshNavigation();
}

function invalidateWorldAsset(card) {
  completedStages.delete("world");
  completedStages.delete("create");
  completedStages.delete("premiere");
  highestUnlocked = stageIndex("world");
  setEpisodeAggregateState({ job: "No paid job enqueued", freshness: "Stale after world-anchor revision", revision: "Draft revision" });
  worldAuthorizationDecision = "pending";
  worldAuthorizationRecorded = false;
  $$('[name="world-decision"]').forEach((input) => { input.checked = input.value === "pending"; });
  card.classList.remove("is-accepted");
  $(".asset-state", card).textContent = "Awaiting your eye";
  const acceptButton = $('[data-asset-action="accept"]', card);
  acceptButton.textContent = "Accept";
  acceptButton.setAttribute("aria-pressed", "false");
  resetProduction();
  updateWorldState();
  refreshNavigation();
}

function assetPath(id) {
  return `../agent-flow/assets/looks/${id}.webp`;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2300);
}

function rememberFocus() {
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

function syncBodyLock() {
  const modalOpen = ["#command-palette", "#look-vault", "#prompt-sheet", "#workspace-panel-overlay", "#repair-overlay"]
    .some((selector) => !$(selector).hidden);
  document.body.style.overflow = modalOpen ? "hidden" : "";
  $(".app-shell").inert = modalOpen;
  $(".monica-orb").inert = modalOpen;
  $("#monica-drawer").inert = modalOpen;
}

function restoreFocus() {
  if (returnFocus?.isConnected && !returnFocus.closest("[hidden]")) returnFocus.focus();
  else $(".brand")?.focus();
  returnFocus = null;
}

function setStage(stage) {
  if (!stageOrder.includes(stage)) return;
  if (!isStageAvailable(stage)) {
    showToast(`Complete ${stageOrder[highestUnlocked]} before opening ${stage}`);
    return;
  }
  currentStage = stage;
  const index = stageOrder.indexOf(stage);
  $$("[data-screen]").forEach((screen) => {
    const active = screen.dataset.screen === stage;
    screen.hidden = !active;
    screen.classList.toggle("is-active", active);
  });
  refreshNavigation();
  $("#journey-progress").style.width = `${(index / (stageOrder.length - 1)) * 100}%`;
  $("#monica-current-stage").textContent = stage[0].toUpperCase() + stage.slice(1);
  $("#monica-drawer-message").textContent = stageMessages[stage];
  if (currentWorkspaceView !== "episode") setWorkspaceView("episode", false);
  updateBlockers();
  const heading = $(`[data-screen="${stage}"] h1`);
  $("#stage-announcer").textContent = `${heading?.textContent || stage} opened`;
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
  window.scrollTo({ top: 0, behavior: scrollBehavior() });
}

function updateBlockers() {
  let blocker = "None";
  if (!scriptLocked) blocker = "Script not locked";
  else if (!completedStages.has("voice") && highestUnlocked <= stageIndex("voice")) blocker = "Narrator not confirmed";
  else if (!completedStages.has("look") && highestUnlocked <= stageIndex("look")) blocker = "Look not confirmed";
  else if (acceptedAssets().length < 3 && highestUnlocked >= stageIndex("world")) blocker = `${3 - acceptedAssets().length} world choices`;
  else if (!worldAuthorizationRecorded && highestUnlocked >= stageIndex("world")) blocker = "Series authorization pending";
  else if (productionState !== "complete" && highestUnlocked >= stageIndex("create")) blocker = "Film not generated";
  $("#monica-blockers").textContent = blocker;
}

function setEpisodeAggregateState({ job, freshness, revision } = {}) {
  const episode = episodeAggregates[activeEpisodeKey];
  if (episode) {
    if (job) episode.job = job;
    if (revision) episode.revision = revision;
    if (freshness) episode.freshness = freshness;
  }
  if (job) $("#episode-job-state").textContent = job;
  if (revision) $("#episode-revision-state").textContent = revision;
  if (freshness) {
    $("#episode-freshness-state").textContent = freshness;
    $("#episode-freshness-state").classList.toggle("is-stale", /stale|invalid/i.test(freshness));
  }
}

function nextStage() {
  if (currentStage === "voice") completeStage("voice", "look");
  else if (currentStage === "look") completeStage("look", "world");
  else if (currentStage === "world" && acceptedAssets().length === 3) completeStage("world", "create");
  else if (currentStage === "create" && productionState === "complete") completeStage("create", "premiere");
}

function previousStage() {
  const previous = stageOrder[Math.max(0, stageOrder.indexOf(currentStage) - 1)];
  setStage(previous);
}

function renderStars() {
  $("#stars").innerHTML = Array.from({ length: 45 }, (_, index) => {
    const left = (index * 41) % 100;
    const top = (index * 67) % 100;
    const delay = -((index * 13) % 40) / 10;
    return `<span style="left:${left}%;top:${top}%;animation-delay:${delay}s"></span>`;
  }).join("");
}

async function updateScriptStats() {
  const words = $("#script-input").value.trim().split(/\s+/).filter(Boolean).length;
  $("#word-count").textContent = String(words);
  const duration = Math.max(1, Math.round((words / 90) * 60));
  $("#duration-estimate").textContent = `${duration} sec · ${duration >= 60 && duration <= 120 ? "within target" : "outside target"}`;
  const data = new TextEncoder().encode($("#script-input").value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  $("#script-hash").textContent = `${hash.slice(0, 4)}…${hash.slice(-4)}`;
}

function lockScript() {
  if (!$("#script-input").value.trim()) {
    showToast("Add the narration before locking it");
    $("#script-input").focus();
    return;
  }
  scriptLocked = true;
  $("#script-input").readOnly = true;
  $("#lock-script").innerHTML = "Words locked <b>✓</b>";
  $("#unlock-script").hidden = false;
  $("#paste-script").hidden = true;
  $("#upload-script").hidden = true;
  completeStage("script", "voice");
  showToast("Exact narration locked as a versioned source");
}

function unlockScript() {
  scriptLocked = false;
  $("#script-input").readOnly = false;
  $("#lock-script").innerHTML = "Lock these words <b>→</b>";
  $("#unlock-script").hidden = true;
  $("#paste-script").hidden = false;
  $("#upload-script").hidden = false;
  invalidateFrom("script");
  setStage("script");
  $("#script-input").focus();
  showToast("Editing creates a new source version and invalidates later work");
}

function renderWaveform() {
  $("#waveform").innerHTML = Array.from({ length: 78 }, (_, index) => {
    const height = 16 + ((index * 37) % 102);
    return `<i style="--h:${height}px;--d:-${(index % 14) / 10}s"></i>`;
  }).join("");
}

function selectVoice(voice) {
  if (voice !== selectedVoice && productionState !== "idle") invalidateProductionOnly();
  selectedVoice = voice;
  $$("[data-voice]").forEach((button) => {
    const selected = button.dataset.voice === voice;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  updateFinalMetadata();
  showToast(`${voice === "male" ? "Male" : "Female"} narrator selected`);
}

function lookMarkup(look) {
  return `<button class="look-option${look.id === selectedLook ? " is-selected" : ""}" type="button" data-look="${look.id}" aria-pressed="${look.id === selectedLook}" data-search="${[look.name, look.family, look.feel].filter(Boolean).join(" ").toLowerCase()}">
    <span><img src="${assetPath(look.id)}" alt="${look.name}" loading="lazy"></span>
    <strong>${look.name}</strong>${look.family ? `<small>${look.family}</small>` : ""}
  </button>`;
}

function updateFinalMetadata() {
  const look = lookOptions.find((item) => item.id === selectedLook);
  $("#final-meta").textContent = `1080 × 1920 · Hindi · ${selectedVoice === "male" ? "Male" : "Female"} narrator · ${look?.name || "Selected look"}`;
}

function applyLookToWorld() {
  const look = lookOptions.find((item) => item.id === selectedLook);
  const illustrativeLooks = ["sacred-folk-scroll", "temple-wall-fresco", "devotional-calendar-art", "indian-mythology-comic", "bright-indian-tv-cartoon"];
  let treatment = "none";
  if (illustrativeLooks.includes(selectedLook)) treatment = "saturate(.78) contrast(1.12) sepia(.2)";
  else if (selectedLook === "divine-fury") treatment = "saturate(1.2) contrast(1.18) brightness(.84)";
  else if (selectedLook === "devotional-temple-gold") treatment = "sepia(.18) saturate(1.12) brightness(.9)";
  else if (selectedLook === "moonlit-day-for-night-blue") treatment = "saturate(.72) hue-rotate(165deg) brightness(.72)";
  $$(".world-asset").forEach((card) => {
    $(".asset-look", card).textContent = look?.name || "Selected look";
    $(".asset-visual img", card).style.filter = treatment;
    if (!card.classList.contains("is-accepted")) {
      $(".asset-state", card).textContent = `Generated in ${look?.name || "selected look"} · awaiting your eye`;
    }
  });
}

function renderLooks() {
  $("#look-ribbon").innerHTML = featuredLooks.slice(0, 8).map(lookMarkup).join("");
  $("#vault-grid").innerHTML = "";
  $("#look-count").textContent = String(Math.min(8, lookOptions.length));
  $(".look-vault header small").textContent = `${lookOptions.length} visual universes`;
  wireLookButtons();
}

function renderVault() {
  const results = lookOptions.filter((look) => {
    const searchable = [look.name, look.family, look.feel].filter(Boolean).join(" ").toLowerCase();
    return !vaultQuery || searchable.includes(vaultQuery);
  });
  $("#vault-grid").innerHTML = results.slice(0, vaultLimit).map(lookMarkup).join("");
  const remaining = Math.max(0, results.length - vaultLimit);
  $("#vault-more").hidden = remaining === 0;
  $("#vault-more").textContent = `Load ${Math.min(24, remaining)} more · ${results.length} matches`;
  wireLookButtons();
}

function wireLookButtons() {
  $$("[data-look]").forEach((button) => button.addEventListener("click", () => {
    selectLook(button.dataset.look);
    if (button.closest("#vault-grid")) closeVault();
  }));
}

function selectLook(id) {
  const look = lookOptions.find((item) => item.id === id);
  if (!look) return;
  if (id !== selectedLook && completedStages.has("look")) invalidateFrom("look");
  selectedLook = id;
  $("#look-hero-image").style.opacity = ".35";
  setTimeout(() => {
    $("#look-hero-image").src = assetPath(id);
    $("#look-hero-image").alt = look.name;
    $("#look-name").textContent = look.name;
    $("#look-feel").textContent = detailedFeel.get(id) || look.feel;
    $("#production-image").src = assetPath(id);
    $("#final-film-image").src = assetPath(id);
    $("#look-hero-image").style.opacity = "1";
  }, 180);
  $$("[data-look]").forEach((button) => button.classList.toggle("is-selected", button.dataset.look === id));
  $$("[data-look]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.look === id)));
  $("#locked-look-dna").textContent = `${look.name}: ${detailedFeel.get(id) || look.feel}`;
  applyLookToWorld();
  updateFinalMetadata();
  showToast(`${look.name} selected`);
}

function openVault() {
  closeCommand(false);
  closePrompt(false);
  rememberFocus();
  vaultQuery = "";
  vaultLimit = 24;
  $("#vault-search").value = "";
  renderVault();
  $("#look-vault").hidden = false;
  syncBodyLock();
  $("#vault-search").focus();
}

function closeVault(shouldRestore = true) {
  if ($("#look-vault").hidden) return;
  $("#look-vault").hidden = true;
  syncBodyLock();
  if (shouldRestore) restoreFocus();
  setTimeout(() => {
    if ($("#look-vault").hidden) {
      $("#vault-grid").innerHTML = "";
      $("#vault-more").hidden = true;
    }
  }, 200);
}

function acceptedAssets() {
  return $$(".world-asset.is-accepted");
}

function updateWorldState() {
  const count = acceptedAssets().length;
  const costAuthorized = $("#authorize-range").checked;
  $("#asset-ready-count").textContent = `${count} / 3`;
  $("#world-continue").disabled = count < 3 || !costAuthorized || worldAuthorizationDecision !== "authorize";
  if (worldAuthorizationRecorded) {
    $("#world-authorization-state").textContent = "Recorded atomically · quote, $40 ceiling, World Bible release 04 and Episode aggregate EP-NEE-01 are bound.";
  } else if (worldAuthorizationDecision === "authorize") {
    $("#world-authorization-state").textContent = count < 3
      ? "Authorization selected, but all three anchors must be accepted before the record can be written."
      : !costAuthorized
        ? "World decision selected, but the current quote and hard ceiling must also be authorized."
        : "Ready to record atomically · quote, ceiling, pinned release and asset revisions will be bound to EP-NEE-01.";
  } else if (worldAuthorizationDecision === "deny") {
    $("#world-authorization-state").textContent = "Denied · production remains blocked and the accepted anchors must be corrected or reconsidered.";
  } else {
    $("#world-authorization-state").textContent = "Pending · no version-bound authorization record exists yet.";
  }
  updateBlockers();
}

function resetWorldAuthorization() {
  worldAuthorizationDecision = "pending";
  worldAuthorizationRecorded = false;
  $("#authorize-range").checked = false;
  $$('[name="world-decision"]').forEach((input) => { input.checked = input.value === "pending"; });
  updateWorldState();
}

function toggleAsset(card) {
  const wasAccepted = card.classList.contains("is-accepted");
  if (completedStages.has("world")) {
    invalidateWorldAsset(card);
    if (wasAccepted) {
      showToast(`${$("h2", card).textContent} unlocked; other anchors were preserved`);
      return;
    }
  }
  card.classList.toggle("is-accepted");
  const accepted = card.classList.contains("is-accepted");
  $(".asset-state", card).textContent = accepted ? "Identity anchor locked ✓" : "Awaiting your eye";
  const acceptButton = $('[data-asset-action="accept"]', card);
  acceptButton.textContent = accepted ? "Accepted ✓" : "Accept";
  acceptButton.setAttribute("aria-pressed", String(accepted));
  updateWorldState();
  showToast(accepted ? `${$("h2", card).textContent} locked` : `${$("h2", card).textContent} unlocked`);
}

function openPrompt(card) {
  activeAsset = card;
  closeCommand(false);
  closeVault(false);
  rememberFocus();
  $("#prompt-title").textContent = `Refine ${$("h2", card).textContent}`;
  $("#asset-prompt").value = assetPrompts[card.dataset.asset];
  const look = lookOptions.find((item) => item.id === selectedLook);
  $("#locked-look-dna").textContent = `${look?.name || "Selected look"}: ${detailedFeel.get(selectedLook) || look?.feel}`;
  $("#prompt-sheet").hidden = false;
  syncBodyLock();
  $("#asset-prompt").focus();
}

function closePrompt(shouldRestore = true) {
  if ($("#prompt-sheet").hidden) return;
  $("#prompt-sheet").hidden = true;
  syncBodyLock();
  if (shouldRestore) restoreFocus();
}

function renderShots() {
  $("#shot-reel").innerHTML = shots.map((shot, index) => `<article class="shot-card" data-shot="${index}">
    <img src="${assetPath(shot.image.replace(".webp", ""))}" alt="">
    <span><small>Shot ${String(index + 1).padStart(2, "0")}</small><strong>${shot.title}</strong><span>${shot.model}</span></span>
  </article>`).join("");
}

function setQualityCheck(index, status) {
  const item = $$(".quality-orbits > div")[index];
  if (!item) return;
  item.classList.remove("is-checking", "is-pass");
  if (status) item.classList.add(status);
  $("small", item).textContent = status === "is-pass" ? "Passed" : status === "is-checking" ? "Checking…" : "Not started";
}

function resetReviewApprovals(message = "Sample qualified-review state. In production, every verdict opens its stored evidence.") {
  culturalApprovalRecorded = false;
  $("#approve-film").disabled = false;
  $("#approve-film").innerHTML = "<span>✦</span> Record qualified cultural review";
  $("#creative-approval-mark").textContent = "○";
  $("#cultural-approval-mark").textContent = "○";
  $("#creative-approval-state").textContent = "Unavailable until cultural approval";
  $("#cultural-approval-state").textContent = "Awaiting authorized reviewer";
  $("#creative-approval-mark").closest("span").classList.remove("is-approved");
  $("#cultural-approval-mark").closest("span").classList.remove("is-approved");
  $("#final-message").textContent = message;
}

function resetProduction() {
  if (productionTimer) clearInterval(productionTimer);
  productionTimer = null;
  productionProgress = 0;
  productionState = "idle";
  $(".production-theatre").setAttribute("aria-busy", "false");
  $(".production-frame").classList.remove("is-running");
  $("#production-stage").textContent = "Ready";
  $("#budget-state").textContent = worldAuthorizationRecorded
    ? "Simulated · $40 hard ceiling · release 04"
    : "Quote and ceiling authorization required";
  $("#production-label").textContent = "Ready to direct";
  $("#production-image").src = assetPath(selectedLook);
  $("#final-film-image").src = assetPath(selectedLook);
  $("#monica-score").textContent = "Waiting";
  $("#monica-note").innerHTML = "<span>◌</span><p>Simulated preview: Monica will explain repairs in plain language while the studio keeps moving.</p>";
  $("#creation-note").textContent = "Nothing has been generated yet";
  if (!worldAuthorizationRecorded) $("#authorize-range").checked = false;
  $("#start-production").disabled = !worldAuthorizationRecorded;
  $("#start-production").innerHTML = worldAuthorizationRecorded
    ? "<span>✦</span><strong>Begin autonomous production</strong><small>Atomic World Lock and simulated cost ceiling recorded</small>"
    : "<span>✦</span><strong>Complete the World Lock first</strong><small>Quote, hard ceiling and Series release must be authorized together</small>";
  $("#pause-production").disabled = true;
  $("#pause-production").textContent = "Pause after current shot";
  $("#premiere-button").disabled = true;
  $$(".shot-card").forEach((card) => card.classList.remove("is-active", "is-done"));
  for (let index = 0; index < 6; index += 1) setQualityCheck(index, "");
  resetReviewApprovals();
  updateBlockers();
}

function updateProduction() {
  productionProgress = Math.min(100, productionProgress + 2);
  $(".production-frame").classList.add("is-running");
  $("#pause-production").disabled = false;
  $("#start-production").disabled = true;

  const shotIndex = Math.min(shots.length - 1, Math.floor(productionProgress / (100 / shots.length)));
  $$(".shot-card").forEach((card, index) => {
    card.classList.toggle("is-active", index === shotIndex);
    card.classList.toggle("is-done", index < shotIndex);
  });
  const shot = shots[shotIndex];
  $("#production-image").src = assetPath(shot.image.replace(".webp", ""));
  $("#production-label").textContent = `${shot.title} · ${shot.model}`;
  $("#production-stage").textContent = productionProgress < 12
    ? "Planning"
    : productionProgress < 82
      ? `Shot ${shotIndex + 1} of ${shots.length}`
      : productionProgress < 94 ? "Assembly" : "Episode review";
  $("#budget-state").textContent = productionProgress < 12
    ? "Provider estimates are being grouped"
    : "Quality-first routing · range retained in job record";

  const qualityIndex = Math.min(5, Math.floor(productionProgress / 17));
  for (let index = 0; index < 6; index += 1) {
    setQualityCheck(index, index < qualityIndex ? "is-pass" : index === qualityIndex ? "is-checking" : "");
  }
  $("#monica-score").textContent = productionProgress < 18
    ? "Observing"
    : productionProgress < 42 ? "Reviewing" : productionProgress < 60 ? "Repairing" : "Evidence building";

  if (productionProgress === 42) {
    $("#monica-note").innerHTML = "<span>✦</span><p>Sample repair: Shot 04 showed unstable rudraksha beads, so Monica rejects only that candidate and requests stronger identity references.</p>";
    showToast("Simulation: Monica repaired a continuity issue without stopping production");
  }

  if (productionProgress >= 100) finishProduction();
}

function startProduction() {
  if (productionState === "running" || productionState === "complete") return;
  if (!completedStages.has("world") || acceptedAssets().length !== 3) {
    showToast("Lock all world anchors before production");
    return;
  }
  if (!worldAuthorizationRecorded) {
    showToast("Record the atomic World Lock and cost authorization before production");
    return;
  }
  if (productionState === "idle") productionProgress = 0;
  productionState = "running";
  setEpisodeAggregateState({ job: "JOB-NEE-01-PROD · running", freshness: "Current · inputs pinned", revision: "Production revision 01" });
  $(".production-theatre").setAttribute("aria-busy", "true");
  $("#pause-production").textContent = "Pause after current shot";
  $("#creation-note").textContent = "Prototype simulation running in this page";
  $("#monica-note").innerHTML = "<span>◌</span><p>Simulating a 7-shot plan, model routing and parallel keyframe generation.</p>";
  productionTimer = setInterval(updateProduction, 95);
}

function pauseProduction() {
  if (productionState === "running") {
    clearInterval(productionTimer);
    productionTimer = null;
    productionState = "paused";
    setEpisodeAggregateState({ job: "JOB-NEE-01-PROD · paused safely" });
    $(".production-theatre").setAttribute("aria-busy", "false");
    $("#pause-production").textContent = "Resume production";
    $("#creation-note").textContent = "Production paused safely after the current step";
    return;
  }
  if (productionState === "paused") {
    productionState = "running";
    setEpisodeAggregateState({ job: "JOB-NEE-01-PROD · running" });
    $(".production-theatre").setAttribute("aria-busy", "true");
    $("#pause-production").textContent = "Pause after current shot";
    productionTimer = setInterval(updateProduction, 95);
    $("#creation-note").textContent = "Prototype simulation running in this page";
  }
}

function finishProduction() {
  clearInterval(productionTimer);
  productionTimer = null;
  productionState = "complete";
  setEpisodeAggregateState({ job: "JOB-NEE-01-PROD · completed", freshness: "Current · regression checked", revision: "Candidate 01" });
  $(".production-theatre").setAttribute("aria-busy", "false");
  $(".production-frame").classList.remove("is-running");
  $$(".shot-card").forEach((card) => { card.classList.remove("is-active"); card.classList.add("is-done"); });
  for (let index = 0; index < 6; index += 1) setQualityCheck(index, "is-pass");
  $("#monica-score").textContent = "Evidence ready";
  $("#production-stage").textContent = "Candidate ready";
  $("#budget-state").textContent = "Simulated run · provider quote intentionally omitted";
  $("#production-label").textContent = "Sample candidate assembled";
  $("#production-image").src = assetPath(selectedLook);
  $("#final-film-image").src = assetPath(selectedLook);
  $("#monica-note").innerHTML = "<span>✓</span><p>Simulation complete. In production, each pass would link to versioned evidence and thresholds.</p>";
  $("#creation-note").textContent = "Simulated · one targeted repair · complete shot set";
  $("#premiere-button").disabled = false;
  $("#start-production").innerHTML = "<span>✓</span><strong>Simulation complete</strong><small>7 shots · final mix · captions · sample evidence</small>";
  $("#pause-production").disabled = true;
  updateBlockers();
  showToast("The final film is ready");
}

function openWorkspacePanel(tab = "jobs") {
  const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  closeCommand(false);
  closeVault(false);
  closePrompt(false);
  closeRepair(false);
  returnFocus = trigger?.closest?.("#repair-overlay") ? $("#repair-film") : trigger;
  setWorkspacePanelTab(tab);
  $("#workspace-panel-overlay").hidden = false;
  syncBodyLock();
  $(".workspace-panel [data-close-workspace-panel]").focus();
}

function closeWorkspacePanel(shouldRestore = true) {
  if ($("#workspace-panel-overlay").hidden) return;
  $("#workspace-panel-overlay").hidden = true;
  syncBodyLock();
  if (shouldRestore) restoreFocus();
}

function setWorkspacePanelTab(tab) {
  $$("[data-workspace-tab]").forEach((button) => {
    const active = button.dataset.workspaceTab === tab;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  $$("[data-workspace-tab-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.workspaceTabPanel !== tab;
  });
}

function formatTimecode(value) {
  const seconds = Math.max(0, Number(value) || 0);
  const minutes = Math.floor(seconds / 60);
  const remaining = (seconds % 60).toFixed(1).padStart(4, "0");
  return `${String(minutes).padStart(2, "0")}:${remaining}`;
}

function parseTimecode(value) {
  const match = String(value).trim().match(/^(\d{2}):([0-5]\d)(?:\.(\d))?$/);
  if (!match) return null;
  const seconds = Number(match[1]) * 60 + Number(match[2]) + Number(`0.${match[3] || 0}`);
  return seconds <= 68 ? seconds : null;
}

function detectScriptChangeIntent(text) {
  const query = text.toLowerCase()
    .replace(/do not change (?:the )?(?:words|script|line|narration)/g, "")
    .replace(/don['’]t change (?:the )?(?:words|script|line|narration)/g, "")
    .replace(/keep (?:every|the|all) (?:spoken )?(?:word|words|script|line)/g, "");
  return /rewrite|change (?:the )?(?:word|words|script|line|narration)|remove (?:this |the )?(?:sentence|line|word)|add (?:a |another )?(?:sentence|line)|replace (?:this |the )?(?:sentence|line|word)|say something different|different words/.test(query);
}

function repairDirection(text) {
  const query = text.toLowerCase();
  if (/more|increase|raise|louder|brighter|faster|longer|stronger/.test(query)) return 1;
  if (/less|reduce|lower|quieter|darker|slower|shorter|softer/.test(query)) return -1;
  return 0;
}

function validateRepairNotes() {
  const errors = new Map(repairNotes.map((note) => [note.id, []]));
  repairNotes.forEach((note) => {
    const start = parseTimecode(note.start);
    const end = note.end.trim() ? parseTimecode(note.end) : null;
    if (!note.start.trim()) errors.get(note.id).push("Start time is required.");
    else if (start === null) errors.get(note.id).push("Use MM:SS.d within the 01:08 sample timeline.");
    if (note.end.trim() && end === null) errors.get(note.id).push("End time must use MM:SS.d within the 01:08 sample timeline.");
    if (start !== null && end !== null && end <= start) errors.get(note.id).push("End time must be later than start time.");
    if (!note.text.trim()) errors.get(note.id).push("Feedback cannot be empty.");
    if (detectScriptChangeIntent(note.text)) {
      errors.get(note.id).push("Script-change request detected. Targeted repair cannot alter supplied words; create a new script version or clarify that only performance/visual treatment should change.");
    }
    if (/lip[ -]?sync|new dialogue|add dialogue|horizontal|16:9|landscape version/.test(note.text.toLowerCase())) {
      errors.get(note.id).push("Unsupported launch-scope request detected. This repair room supports the existing vertical, background-narration episode only.");
    }
  });

  for (let leftIndex = 0; leftIndex < repairNotes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < repairNotes.length; rightIndex += 1) {
      const left = repairNotes[leftIndex];
      const right = repairNotes[rightIndex];
      const leftStart = parseTimecode(left.start);
      const rightStart = parseTimecode(right.start);
      if (leftStart === null || rightStart === null) continue;
      const leftEnd = parseTimecode(left.end) ?? leftStart + .1;
      const rightEnd = parseTimecode(right.end) ?? rightStart + .1;
      const overlaps = leftStart < rightEnd && rightStart < leftEnd;
      const sameDomain = interpretRepair(left.text).kind === interpretRepair(right.text).kind;
      const opposed = repairDirection(left.text) * repairDirection(right.text) === -1;
      if (overlaps && sameDomain && opposed) {
        const message = `Potential conflict with feedback ${rightIndex + 1}: overlapping directions appear to oppose each other. Clarify which instruction wins.`;
        const reciprocal = `Potential conflict with feedback ${leftIndex + 1}: overlapping directions appear to oppose each other. Clarify which instruction wins.`;
        errors.get(left.id).push(message);
        errors.get(right.id).push(reciprocal);
      }
    }
  }
  return { errors, valid: [...errors.values()].every((messages) => messages.length === 0) };
}

function applyRepairValidation(showBanner = false) {
  const validation = validateRepairNotes();
  let firstMessage = "";
  $$(".repair-row").forEach((row) => {
    const messages = validation.errors.get(Number(row.dataset.repairRow)) || [];
    const message = $(".repair-row-message", row);
    const hasConflict = messages.some((item) => item.startsWith("Potential conflict"));
    row.classList.toggle("is-invalid", messages.length > 0 && !hasConflict);
    row.classList.toggle("is-conflicted", hasConflict);
    $$("input, textarea", row).forEach((field) => field.setAttribute("aria-invalid", String(messages.length > 0)));
    message.hidden = messages.length === 0;
    message.textContent = messages.join(" ");
    if (!firstMessage && messages.length) firstMessage = messages[0];
  });
  const banner = $("#repair-clarification-banner");
  banner.hidden = !showBanner || validation.valid;
  banner.textContent = validation.valid ? "" : `Monica cannot build the repair plan yet. ${firstMessage}`;
  return validation.valid;
}

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function stableRepairPlanHash(notes) {
  const payload = JSON.stringify(notes.map(({ start, end, text }) => ({ start, end, text })));
  let hash = 2166136261;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `RP-${(hash >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
}

function interpretRepair(text) {
  const query = text.toLowerCase();
  if (detectScriptChangeIntent(text)) {
    return {
      kind: "clarification",
      title: "Clarification required: script revision",
      summary: "Targeted repair protects the exact supplied narration. Clarify a performance or visual change, or create a new script version before continuing.",
      chips: ["script locked", "human decision", "plan blocked"],
    };
  }
  if (/music|score|voice|narrat|sfx|sound|audio|pronunciation|loud/.test(query)) {
    return {
      kind: "audio",
      title: "Audio and mix repair",
      summary: "Preserve the exact narration and voice identity; adjust the affected stem or performance, rebuild the mix seam, then recheck alignment and loudness.",
      chips: ["voice locked", "stem-level", "mix boundary"],
    };
  }
  if (/caption|subtitle|word|spelling|text/.test(query)) {
    return {
      kind: "caption",
      title: "Caption alignment repair",
      summary: "Keep the supplied words immutable; correct timing or presentation for the selected caption group and rerun alignment checks.",
      chips: ["script locked", "caption group", "alignment"],
    };
  }
  if (/face|character|rudraksha|crown|ornament|costume|eye|hand|body|look/.test(query)) {
    return {
      kind: "visual",
      title: "Identity-led shot repair",
      summary: "Regenerate the underlying shot with approved identity anchors, preserve requested camera intent, then inspect both neighboring boundaries and episode continuity.",
      chips: ["identity anchor", "whole shot", "boundary QC"],
    };
  }
  return {
    kind: "edit",
    title: "Editorial repair",
    summary: "Map the note to the smallest safe shot, transition or timing unit, preserve unaffected tracks, then reassemble and rerun episode-level checks.",
    chips: ["minimal scope", "timeline-aware", "regression QC"],
  };
}

function interpretationMarkup(note) {
  const interpretation = interpretRepair(note.text);
  return `<small>Monica’s interpretation</small><strong>${interpretation.title}</strong><p>${interpretation.summary}</p><div>${interpretation.chips.map((chip) => `<span>${chip}</span>`).join("")}</div>`;
}

function renderRepairRows() {
  $("#repair-rows").innerHTML = repairNotes.map((note, index) => `<article class="repair-row" data-repair-row="${note.id}">
    <div class="repair-time-fields">
      <label>Start<input type="text" inputmode="decimal" value="${escapeHTML(note.start)}" data-repair-start aria-label="Feedback ${index + 1} start time"></label>
      <label>End<input type="text" inputmode="decimal" value="${escapeHTML(note.end)}" data-repair-end aria-label="Feedback ${index + 1} end time"></label>
    </div>
    <div class="repair-feedback">
      <label for="repair-feedback-${note.id}">Feedback ${index + 1}</label>
      <textarea id="repair-feedback-${note.id}" data-repair-text>${escapeHTML(note.text)}</textarea>
    </div>
    <div class="repair-interpretation" aria-live="polite">${interpretationMarkup(note)}</div>
    <button class="remove-repair-row" type="button" data-remove-repair aria-label="Remove feedback ${index + 1}">×</button>
    <p class="repair-row-message" role="alert" hidden></p>
  </article>`).join("");

  $$(".repair-row").forEach((row) => {
    const note = repairNotes.find((item) => item.id === Number(row.dataset.repairRow));
    $("[data-repair-start]", row).addEventListener("input", (event) => { note.start = event.target.value; applyRepairValidation(false); });
    $("[data-repair-end]", row).addEventListener("input", (event) => { note.end = event.target.value; applyRepairValidation(false); });
    $("[data-repair-text]", row).addEventListener("input", (event) => {
      note.text = event.target.value;
      $(".repair-interpretation", row).innerHTML = interpretationMarkup(note);
      applyRepairValidation(false);
    });
    $("[data-remove-repair]", row).addEventListener("click", () => {
      if (repairNotes.length === 1) {
        showToast("Keep one feedback row, or close the Repair Room without applying changes");
        return;
      }
      repairNotes = repairNotes.filter((item) => item.id !== note.id);
      renderRepairRows();
      $("#stage-announcer").textContent = "Feedback row removed";
    });
  });
  applyRepairValidation(false);
}

function addRepairNote(timecode = formatTimecode($("#repair-playhead").value)) {
  repairNoteSequence += 1;
  repairNotes.push({
    id: repairNoteSequence,
    start: timecode,
    end: "",
    text: "",
  });
  renderRepairRows();
  const row = $(`[data-repair-row="${repairNoteSequence}"]`);
  row?.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
  $("[data-repair-text]", row)?.focus();
}

function setRepairView(view) {
  $$("[data-repair-view]").forEach((section) => {
    section.hidden = section.dataset.repairView !== view;
  });
  const order = ["brief", "plan", "result"];
  const activeIndex = order.indexOf(view);
  $$("[data-repair-step]").forEach((button) => {
    const index = order.indexOf(button.dataset.repairStep);
    button.classList.toggle("is-active", index === activeIndex);
    button.classList.toggle("is-complete", index < activeIndex);
    button.setAttribute("aria-current", index === activeIndex ? "step" : "false");
  });
  $(".repair-workbench").scrollTo({ top: 0, behavior: scrollBehavior() });
}

function renderRepairPlan() {
  if (!applyRepairValidation(true)) {
    $("#repair-clarification-banner").scrollIntoView({ behavior: scrollBehavior(), block: "center" });
    return false;
  }
  const populated = repairNotes.filter((note) => note.text.trim());
  if (!populated.length) {
    showToast("Describe at least one repair before Monica builds the plan");
    $("[data-repair-text]")?.focus();
    return false;
  }
  const grouped = new Map();
  populated.forEach((note) => {
    const interpretation = interpretRepair(note.text);
    if (!grouped.has(interpretation.kind)) grouped.set(interpretation.kind, []);
    grouped.get(interpretation.kind).push({ note, interpretation });
  });
  $("#plan-summary-copy").textContent = `${populated.length} feedback ${populated.length === 1 ? "row has" : "rows have"} been resolved into ${grouped.size} repair work ${grouped.size === 1 ? "unit" : "units"}. Overlapping dependencies are grouped so Monica does not make one blind generation call per row.`;
  const taskLabels = {
    visual: ["VISUAL", "Regenerate identity-anchored shot candidate", "Rebuild the full underlying shot and inspect adjacent transitions."],
    audio: ["AUDIO", "Repair affected audio stem and mix boundary", "Preserve words and voice identity; reassemble the continuous mix."],
    caption: ["CAPTION", "Realign caption group", "Correct the selected presentation unit against locked narration timestamps."],
    edit: ["EDIT", "Rebuild the smallest timeline dependency", "Preserve unaffected tracks and inspect the resulting episode rhythm."],
  };
  $("#repair-task-list").innerHTML = [...grouped.entries()].map(([kind, items], index) => {
    const [label, title, detail] = taskLabels[kind];
    const range = escapeHTML(items.map(({ note }) => note.end ? `${note.start}–${note.end}` : note.start).join(", "));
    return `<article class="repair-task"><span>${String(index + 1).padStart(2, "0")}</span><div><small>${label} · ${range}</small><strong>${title}</strong><em>${detail}</em></div><b>${items.length} ${items.length === 1 ? "note" : "notes"}</b></article>`;
  }).join("");
  const expected = 4 + grouped.size * 3;
  const high = expected + Math.max(3, grouped.size * 2);
  $("#repair-plan-hash").textContent = stableRepairPlanHash(populated);
  $("#repair-dependency-scope").textContent = [...grouped.keys()].map((kind) => `${kind} + boundaries`).join(" · ");
  $("#repair-expected-cost").textContent = `$${expected} expected`;
  $("#repair-high-cost").textContent = `$${high} high`;
  $("#repair-ceiling-confirm").checked = false;
  $("#repair-ceiling-confirm").disabled = high > 18;
  $("#repair-ceiling-copy").textContent = high > 18
    ? `High estimate $${high} exceeds the simulated $18 ceiling · revise scope or raise authorization`
    : "Authorize a simulated hard ceiling of $18";
  $("#apply-repair-plan").disabled = true;
  $("#repair-resolution-list").innerHTML = populated.map((note) => {
    const interpretation = interpretRepair(note.text);
    return `<article class="repair-resolution"><span>${escapeHTML(note.end ? `${note.start}–${note.end}` : note.start)}</span><div><strong>${interpretation.title}</strong><small>${escapeHTML(note.text)}</small></div><b>RESOLVED</b></article>`;
  }).join("");
  return true;
}

function openRepair() {
  const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  closeCommand(false);
  closeVault(false);
  closePrompt(false);
  closeWorkspacePanel(false);
  returnFocus = trigger?.closest?.("#workspace-panel-overlay") ? $(".inbox-button") : trigger;
  renderRepairRows();
  setRepairView("brief");
  setVersionPreview("before");
  $("#repair-overlay").hidden = false;
  syncBodyLock();
  $("[data-close-repair]").focus();
}

function closeRepair(shouldRestore = true) {
  if ($("#repair-overlay").hidden) return;
  if (repairPlaybackTimer) clearInterval(repairPlaybackTimer);
  repairPlaybackTimer = null;
  $("#repair-play").textContent = "▶";
  $("#repair-overlay").hidden = true;
  syncBodyLock();
  if (shouldRestore) restoreFocus();
}

function setVersionPreview(version) {
  $$("[data-version-preview]").forEach((button) => {
    const active = button.dataset.versionPreview === version;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("#repair-preview-image").style.opacity = ".35";
  setTimeout(() => {
    $("#repair-preview-image").src = version === "before"
      ? assetPath("moonlit-day-for-night-blue")
      : assetPath("glowing-divine-realism");
    $("#repair-frame-label").textContent = version === "before"
      ? "A · Base candidate · Revision 01"
      : "B · Repaired candidate · Revision 02";
    $("#repair-preview-image").style.opacity = "1";
  }, 120);
}

function openMonica() {
  $("#monica-drawer").hidden = false;
}

function closeMonica() {
  $("#monica-drawer").hidden = true;
}

function openCommand() {
  closeMonica();
  const trigger = document.activeElement;
  closeVault(false);
  closePrompt(false);
  closeWorkspacePanel(false);
  closeRepair(false);
  returnFocus = trigger?.closest?.("#look-vault, #prompt-sheet") ? $("[data-open-command]") : trigger;
  $("#command-palette").hidden = false;
  syncBodyLock();
  $("#command-input").value = "";
  filterCommands("");
  $("#command-input").focus();
}

function closeCommand(shouldRestore = true) {
  if ($("#command-palette").hidden) return;
  $("#command-palette").hidden = true;
  syncBodyLock();
  if (shouldRestore) restoreFocus();
}

function filterCommands(value) {
  const query = value.trim().toLowerCase();
  $$(".command-list button").forEach((button) => {
    button.hidden = query && !button.textContent.toLowerCase().includes(query);
  });
}

function resetFilm() {
  if (productionTimer) clearInterval(productionTimer);
  if (playbackTimer) clearInterval(playbackTimer);
  productionTimer = null;
  playbackTimer = null;
  playbackFrame = 0;
  completedStages.clear();
  highestUnlocked = 0;
  scriptLocked = false;
  selectedVoice = "male";
  selectedLook = "glowing-divine-realism";
  worldAuthorizationDecision = "pending";
  worldAuthorizationRecorded = false;
  performanceVersion = 1;
  assetPrompts = { ...defaultAssetPrompts };
  activeAsset = null;
  returnFocus = null;
  closeCommand(false);
  closeVault(false);
  closePrompt(false);
  closeMonica();
  $(".final-film").classList.remove("is-playing");
  $("#final-play span").textContent = "▶";
  $("#waveform").classList.remove("is-playing");
  $("#voice-play b").textContent = "▶";
  $("#voice-play span").textContent = "Hear the opening";
  $("#pace").value = "58";
  $("#pace-output").textContent = "0.96×";
  $("#post-tts-duration").textContent = "01:08";
  $("#performance-version").textContent = "Voice 01";
  $$('[name="world-decision"]').forEach((input) => { input.checked = input.value === "pending"; });
  $("#vault-search").value = "";
  $("#script-input").value = "";
  $("#script-input").readOnly = false;
  $("#lock-script").innerHTML = "Lock these words <b>→</b>";
  $("#unlock-script").hidden = true;
  $("#paste-script").hidden = false;
  $("#upload-script").hidden = false;
  selectVoice("male");
  selectLook("glowing-divine-realism");
  $$(".world-asset").forEach((card) => {
    card.classList.remove("is-accepted");
    $(".asset-state", card).textContent = "Awaiting your eye";
    const acceptButton = $('[data-asset-action="accept"]', card);
    acceptButton.textContent = "Accept";
    acceptButton.setAttribute("aria-pressed", "false");
  });
  resetProduction();
  updateScriptStats();
  updateWorldState();
  refreshNavigation();
  setStage("script");
  showToast("New film started with a clean production state");
}

function wireEvents() {
  $$("[data-view]").forEach((button) => button.addEventListener("click", () => setWorkspaceView(button.dataset.view)));
  $$("[data-open-episode]").forEach((button) => button.addEventListener("click", () => openEpisodeAt(button.dataset.openEpisode, button.dataset.episodeKey)));
  $$("[data-new-episode]").forEach((button) => button.addEventListener("click", () => {
    resetFilm();
    selectEpisodeAggregate("neelkanth02");
    showToast("New episode started with World Bible release 04 ready to inherit after the script is locked");
  }));
  $$("[data-series-tab]").forEach((button) => {
    button.addEventListener("click", () => setSeriesTab(button.dataset.seriesTab));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const tabs = $$("[data-series-tab]");
      const current = tabs.indexOf(button);
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].focus();
      setSeriesTab(tabs[next].dataset.seriesTab);
    });
  });
  $("#studio-search").addEventListener("input", (event) => {
    const query = event.target.value.trim().toLowerCase();
    let visible = 0;
    $$("#series-card-grid [data-searchable]").forEach((card) => {
      card.hidden = query && !card.dataset.searchable.toLowerCase().includes(query);
      if (!card.hidden) visible += 1;
    });
    $("#studio-search-empty").hidden = visible !== 0;
  });
  $("#episode-search").addEventListener("input", (event) => {
    const query = event.target.value.trim().toLowerCase();
    $$(".episode-tile").forEach((card) => {
      card.hidden = query && !card.dataset.episodeSearch.toLowerCase().includes(query);
    });
  });
  $$("[data-open-workspace-panel]").forEach((button) => button.addEventListener("click", () => openWorkspacePanel(button.dataset.openWorkspacePanel)));
  $$("[data-close-workspace-panel]").forEach((button) => button.addEventListener("click", closeWorkspacePanel));
  $$("[data-workspace-tab]").forEach((button) => {
    button.addEventListener("click", () => setWorkspacePanelTab(button.dataset.workspaceTab));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const tabs = $$("[data-workspace-tab]");
      const next = (tabs.indexOf(button) + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].focus();
      setWorkspacePanelTab(tabs[next].dataset.workspaceTab);
    });
  });
  $$("[data-open-repair]").forEach((button) => button.addEventListener("click", openRepair));
  $$("[data-close-repair]").forEach((button) => button.addEventListener("click", closeRepair));
  $("#repair-playhead").addEventListener("input", (event) => {
    const timecode = formatTimecode(event.target.value);
    $("#repair-playhead-label").textContent = timecode;
    $("#capture-time").textContent = timecode;
    const cursor = `${(Number(event.target.value) / Number(event.target.max)) * 100}%`;
    $("#repair-timeline-cursor").style.setProperty("--cursor", cursor);
  });
  $("#repair-play").addEventListener("click", () => {
    if (repairPlaybackTimer) {
      clearInterval(repairPlaybackTimer);
      repairPlaybackTimer = null;
      $("#repair-play").textContent = "▶";
      return;
    }
    $("#repair-play").textContent = "Ⅱ";
    repairPlaybackTimer = setInterval(() => {
      const playhead = $("#repair-playhead");
      const next = Number(playhead.value) + .5;
      playhead.value = next > Number(playhead.max) ? 0 : next;
      playhead.dispatchEvent(new Event("input"));
    }, 400);
  });
  $("#capture-repair-note").addEventListener("click", () => addRepairNote());
  $("#add-repair-row").addEventListener("click", () => addRepairNote(""));
  $("#build-repair-plan").addEventListener("click", () => {
    if (renderRepairPlan()) setRepairView("plan");
  });
  $("#repair-ceiling-confirm").addEventListener("change", (event) => {
    $("#apply-repair-plan").disabled = !event.target.checked;
  });
  $$("[data-repair-back]").forEach((button) => button.addEventListener("click", () => setRepairView(button.dataset.repairBack)));
  $("#apply-repair-plan").addEventListener("click", () => {
    if (!$("#repair-ceiling-confirm").checked) {
      showToast("Confirm the simulated hard ceiling before Monica enqueues paid repair work");
      $("#repair-ceiling-confirm").focus();
      return;
    }
    const button = $("#apply-repair-plan");
    button.disabled = true;
    button.innerHTML = "Simulating durable repair… <b>◌</b>";
    $("#repair-frame-label").textContent = "Repair batch running · base preserved";
    setEpisodeAggregateState({ job: "JOB-NEE-01-REPAIR · running", revision: "Repair revision 02", freshness: "Repair in progress" });
    setTimeout(() => {
      button.disabled = false;
      button.innerHTML = "Apply versioned repair <b>✦</b>";
      setVersionPreview("after");
      setRepairView("result");
      setEpisodeAggregateState({ job: "JOB-NEE-01-REPAIR · completed", freshness: "Current · repaired candidate checked", revision: "Candidate 02" });
      $("#stage-announcer").textContent = "Simulated repaired candidate is ready for comparison";
    }, 900);
  });
  $$("[data-version-preview]").forEach((button) => button.addEventListener("click", () => setVersionPreview(button.dataset.versionPreview)));
  $("#accept-repair-result").addEventListener("click", () => {
    closeRepair();
    resetReviewApprovals("Prototype: Candidate 02 is now the pending qualified-review target. Prior decisions were superseded; Revision 01 remains preserved for rollback and audit.");
    setEpisodeAggregateState({ job: "No active job", freshness: "Current · qualified cultural review required", revision: "Candidate 02" });
    $("#stage-announcer").textContent = "Candidate 02 promoted to qualified cultural review; creative review is not yet available";
    showToast("Candidate 02 promoted; qualified cultural review is required first");
  });
  $$("[data-stage]").forEach((button) => button.addEventListener("click", () => setStage(button.dataset.stage)));
  $$("[data-go]").forEach((button) => button.addEventListener("click", () => setStage(button.dataset.go)));
  $$("[data-next]").forEach((button) => button.addEventListener("click", nextStage));
  $$("[data-prev]").forEach((button) => button.addEventListener("click", previousStage));
  $$("[data-voice]").forEach((button) => button.addEventListener("click", () => selectVoice(button.dataset.voice)));
  $("#script-input").addEventListener("input", updateScriptStats);
  $("#lock-script").addEventListener("click", lockScript);
  $("#unlock-script").addEventListener("click", unlockScript);
  $("#paste-script").addEventListener("click", () => showToast("Prototype: clipboard permission and paste flow opens here"));
  $("#upload-script").addEventListener("click", () => showToast("Prototype: script file picker opens here"));
  $("#voice-play").addEventListener("click", () => {
    const waveform = $("#waveform");
    const playing = waveform.classList.toggle("is-playing");
    $("#voice-play b").textContent = playing ? "Ⅱ" : "▶";
    $("#voice-play span").textContent = playing ? "Pause sample" : "Hear the opening";
    showToast("Prototype: waveform simulates the selected ElevenLabs voice sample");
  });
  $("#pace").addEventListener("input", (event) => {
    if (productionState !== "idle") invalidateProductionOnly();
    const rate = 0.82 + Number(event.target.value) * .0024;
    $("#pace-output").textContent = `${rate.toFixed(2)}×`;
    const duration = Math.max(60, Math.min(120, Math.round(68 * (.96 / rate))));
    $("#post-tts-duration").textContent = formatTimecode(duration).replace(".0", "");
    setEpisodeAggregateState({ freshness: "Stale · performance timing changed" });
  });
  $("#pace").addEventListener("change", () => {
    performanceVersion += 1;
    $("#performance-version").textContent = `Voice ${String(performanceVersion).padStart(2, "0")}`;
    showToast("Simulated voice revision created; timing-dependent artifacts are stale");
  });
  $("#open-look-vault").addEventListener("click", openVault);
  $("#inspect-dna").addEventListener("click", () => showToast("Look DNA: sacred radiance · gold-blue palette · cinematic facial detail · atmospheric depth"));
  $$("[data-close-vault]").forEach((button) => button.addEventListener("click", closeVault));
  $("#vault-search").addEventListener("input", (event) => {
    vaultQuery = event.target.value.trim().toLowerCase();
    vaultLimit = 24;
    renderVault();
  });
  $("#vault-more").addEventListener("click", () => {
    vaultLimit += 24;
    renderVault();
  });
  $$("[data-asset-action]").forEach((button) => button.addEventListener("click", () => {
    const card = button.closest(".world-asset");
    if (button.dataset.assetAction === "accept") toggleAsset(card);
    if (button.dataset.assetAction === "prompt") openPrompt(card);
    if (button.dataset.assetAction === "upload") showToast(`Prototype: upload your own ${$(".asset-kind", card).textContent.toLowerCase()} reference`);
  }));
  $$('[name="world-decision"]').forEach((input) => input.addEventListener("change", (event) => {
    worldAuthorizationDecision = event.target.value;
    worldAuthorizationRecorded = false;
    updateWorldState();
  }));
  $("#world-continue").addEventListener("click", () => {
    if (acceptedAssets().length !== 3 || worldAuthorizationDecision !== "authorize" || !$("#authorize-range").checked) {
      showToast("Accept every anchor, authorize the quote ceiling and approve the pinned Series release");
      return;
    }
    worldAuthorizationRecorded = true;
    $("#episode-freshness-state").textContent = "Current · release 04 bound";
    $("#budget-state").textContent = "Simulated · $40 hard ceiling · release 04";
    $("#start-production").disabled = false;
    $("#start-production").innerHTML = "<span>✦</span><strong>Begin autonomous production</strong><small>Atomic World Lock and simulated cost ceiling recorded</small>";
    $("#creation-note").textContent = "Atomic operating authorization recorded; no additional creative gate exists before final review";
    updateWorldState();
    completeStage("world", "create");
    showToast("Simulated quote, ceiling and World Lock recorded atomically");
  });
  $$("[data-close-prompt]").forEach((button) => button.addEventListener("click", closePrompt));
  $("#regenerate-asset").addEventListener("click", () => {
    if (!activeAsset) return;
    const assetBeingRegenerated = activeAsset;
    assetPrompts[assetBeingRegenerated.dataset.asset] = $("#asset-prompt").value.trim();
    if (completedStages.has("world")) invalidateWorldAsset(assetBeingRegenerated);
    closePrompt();
    $(".asset-state", assetBeingRegenerated).textContent = "Regenerating…";
    assetBeingRegenerated.classList.remove("is-accepted");
    updateWorldState();
    setTimeout(() => {
      $(".asset-state", assetBeingRegenerated).textContent = "New option ready";
      showToast("Prototype: a revised option is ready for your eye");
    }, 900);
  });
  $("#start-production").addEventListener("click", startProduction);
  $("#authorize-range").addEventListener("change", () => {
    if (worldAuthorizationRecorded) {
      worldAuthorizationRecorded = false;
      setEpisodeAggregateState({ job: "No paid job enqueued", freshness: "Stale · authorization changed", revision: "Draft revision" });
    }
    updateWorldState();
  });
  $("#pause-production").addEventListener("click", pauseProduction);
  $("#final-play").addEventListener("click", () => {
    const film = $(".final-film");
    if (playbackTimer) {
      clearInterval(playbackTimer);
      playbackTimer = null;
      film.classList.remove("is-playing");
      $("#final-play span").textContent = "▶";
      return;
    }
    const frames = ["glowing-divine-realism", "divine-fury", "moonlit-day-for-night-blue", "devotional-temple-gold"];
    playbackFrame = 0;
    film.classList.add("is-playing");
    $("#final-play span").textContent = "Ⅱ";
    playbackTimer = setInterval(() => {
      playbackFrame += 1;
      $("#final-film-image").src = assetPath(frames[playbackFrame % frames.length]);
      if (playbackFrame > 6) {
        clearInterval(playbackTimer);
        playbackTimer = null;
        film.classList.remove("is-playing");
        $("#final-play span").textContent = "▶";
          $("#final-film-image").src = assetPath(selectedLook);
      }
    }, 750);
  });
  $("#approve-film").addEventListener("click", () => {
    if (!culturalApprovalRecorded) {
      culturalApprovalRecorded = true;
      $("#cultural-approval-mark").textContent = "✓";
      $("#cultural-approval-state").textContent = "Simulated qualified cultural record stored";
      $("#cultural-approval-mark").closest("span").classList.add("is-approved");
      $("#creative-approval-state").textContent = "Now available for current reviewer";
      $("#approve-film").innerHTML = "<span>✦</span> Record creative approval & export";
      $("#final-message").textContent = "Prototype: the exact culturally approved candidate has entered separate creative/final review.";
      showToast("Qualified cultural approval stored; creative review is now available");
      return;
    }
    $("#approve-film").disabled = true;
    $("#approve-film").innerHTML = "<span>✓</span> Approved in prototype";
    $("#creative-approval-mark").textContent = "✓";
    $("#creative-approval-state").textContent = "Simulated human creative record stored";
    $("#creative-approval-mark").closest("span").classList.add("is-approved");
    $("#final-message").textContent = "Prototype: the separate creative/final approval was stored after cultural approval, then export packaging was requested.";
    showToast("Creative/final approval stored; export packaging requested");
  });
  $("#repair-film").addEventListener("click", () => {
    openRepair();
  });
  $("#create-another").addEventListener("click", resetFilm);
  $$("[data-open-monica]").forEach((button) => button.addEventListener("click", openMonica));
  $$("[data-close-monica]").forEach((button) => button.addEventListener("click", closeMonica));
  $$("[data-open-command]").forEach((button) => button.addEventListener("click", openCommand));
  $$("[data-close-command]").forEach((button) => button.addEventListener("click", closeCommand));
  $("#command-input").addEventListener("input", (event) => filterCommands(event.target.value));
  $$("[data-command-stage]").forEach((button) => button.addEventListener("click", () => {
    openEpisodeAt(button.dataset.commandStage);
    closeCommand();
  }));
  $$("[data-command-view]").forEach((button) => button.addEventListener("click", () => {
    setWorkspaceView(button.dataset.commandView);
    closeCommand();
  }));
  $$("[data-command-panel]").forEach((button) => button.addEventListener("click", () => {
    const tab = button.dataset.commandPanel;
    closeCommand(false);
    openWorkspacePanel(tab);
  }));
  $$("[data-command-repair]").forEach((button) => button.addEventListener("click", () => {
    closeCommand(false);
    openRepair();
  }));
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openCommand();
    }
    if (event.key === "Escape") {
      if (!$("#repair-overlay").hidden) closeRepair();
      else if (!$("#workspace-panel-overlay").hidden) closeWorkspacePanel();
      else if (!$("#command-palette").hidden) closeCommand();
      else if (!$("#look-vault").hidden) closeVault();
      else if (!$("#prompt-sheet").hidden) closePrompt();
      else closeMonica();
    }
    if (event.key === "Tab") {
      const dialog = [
        $("#command-palette [role='dialog']"),
        $("#look-vault [role='dialog']"),
        $("#prompt-sheet [role='dialog']"),
        $("#workspace-panel-overlay [role='dialog']"),
        $("#repair-overlay [role='dialog']"),
      ].find((candidate) => candidate && !candidate.closest("[hidden]"));
      if (!dialog) return;
      const focusable = $$("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])", dialog)
        .filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ K" : "Ctrl K";
  $$(".command-button kbd").forEach((label) => { label.textContent = shortcut; });
}

renderStars();
renderWaveform();
renderLooks();
renderShots();
renderRepairRows();
updateScriptStats();
updateWorldState();
updateFinalMetadata();
wireEvents();
resetProduction();
setWorkspaceView("home", false);
