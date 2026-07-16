const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const stageOrder = ["script", "voice", "look", "world", "create", "premiere"];
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
const completedStages = new Set();

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
  create: "The crew is dormant. When you begin, I will score every candidate and repair the smallest failing unit.",
  premiere: "The final candidate has passed the launch quality contract. You may approve it or request one precise repair."
};

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
  if (index <= stageIndex("world")) {
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
  resetProduction();
  refreshNavigation();
}

function invalidateWorldAsset(card) {
  completedStages.delete("world");
  completedStages.delete("create");
  completedStages.delete("premiere");
  highestUnlocked = stageIndex("world");
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
  const modalOpen = ["#command-palette", "#look-vault", "#prompt-sheet"]
    .some((selector) => !$(selector).hidden);
  document.body.style.overflow = modalOpen ? "hidden" : "";
  $(".app-shell").inert = modalOpen;
  $(".monica-orb").inert = modalOpen;
}

function restoreFocus() {
  if (returnFocus?.isConnected) returnFocus.focus();
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
  updateBlockers();
  const heading = $(`[data-screen="${stage}"] h1`);
  $("#stage-announcer").textContent = `${heading?.textContent || stage} opened`;
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateBlockers() {
  let blocker = "None";
  if (!scriptLocked) blocker = "Script not locked";
  else if (!completedStages.has("voice") && highestUnlocked <= stageIndex("voice")) blocker = "Narrator not confirmed";
  else if (!completedStages.has("look") && highestUnlocked <= stageIndex("look")) blocker = "Look not confirmed";
  else if (acceptedAssets().length < 3 && highestUnlocked >= stageIndex("world")) blocker = `${3 - acceptedAssets().length} world choices`;
  else if (productionState !== "complete" && highestUnlocked >= stageIndex("create")) blocker = "Film not generated";
  $("#monica-blockers").textContent = blocker;
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
  $("#duration-estimate").textContent = `${Math.max(1, Math.round((words / 90) * 60))} sec`;
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
  $("#asset-ready-count").textContent = `${count} / 3`;
  $("#world-continue").disabled = count < 3;
  updateBlockers();
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

function resetProduction() {
  if (productionTimer) clearInterval(productionTimer);
  productionTimer = null;
  productionProgress = 0;
  productionState = "idle";
  $(".production-theatre").setAttribute("aria-busy", "false");
  $(".production-frame").classList.remove("is-running");
  $("#production-percent").textContent = "0%";
  $("#cost-value").textContent = "0.84";
  $("#production-label").textContent = "Ready to direct";
  $("#production-image").src = assetPath(selectedLook);
  $("#final-film-image").src = assetPath(selectedLook);
  $("#monica-score").textContent = "Waiting";
  $("#monica-note").innerHTML = "<span>◌</span><p>Simulated preview: Monica will explain repairs in plain language while the studio keeps moving.</p>";
  $("#creation-note").textContent = "Nothing has been generated yet";
  $("#start-production").disabled = false;
  $("#start-production").innerHTML = "<span>✦</span><strong>Begin autonomous production</strong><small>Monica may repair any failing shot automatically</small>";
  $("#pause-production").disabled = true;
  $("#pause-production").textContent = "Pause after current shot";
  $("#premiere-button").disabled = true;
  $$(".shot-card").forEach((card) => card.classList.remove("is-active", "is-done"));
  for (let index = 0; index < 6; index += 1) setQualityCheck(index, "");
  $("#approve-film").innerHTML = "<span>✦</span> Approve & export";
  $("#final-message").textContent = "Sample final-review state. In production, every verdict opens its stored evidence.";
  updateBlockers();
}

function updateProduction() {
  productionProgress = Math.min(100, productionProgress + 2);
  $("#production-percent").textContent = `${productionProgress}%`;
  $("#cost-value").textContent = (0.84 + productionProgress * .276).toFixed(2);
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

  const qualityIndex = Math.min(5, Math.floor(productionProgress / 17));
  for (let index = 0; index < 6; index += 1) {
    setQualityCheck(index, index < qualityIndex ? "is-pass" : index === qualityIndex ? "is-checking" : "");
  }
  $("#monica-score").textContent = productionProgress < 18 ? "Observing" : `${Math.min(96, 72 + Math.floor(productionProgress / 4))}/100`;

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
  if (productionState === "idle") productionProgress = 0;
  productionState = "running";
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
    $(".production-theatre").setAttribute("aria-busy", "false");
    $("#pause-production").textContent = "Resume production";
    $("#creation-note").textContent = "Production paused safely after the current step";
    return;
  }
  if (productionState === "paused") {
    productionState = "running";
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
  $(".production-theatre").setAttribute("aria-busy", "false");
  $(".production-frame").classList.remove("is-running");
  $$(".shot-card").forEach((card) => { card.classList.remove("is-active"); card.classList.add("is-done"); });
  for (let index = 0; index < 6; index += 1) setQualityCheck(index, "is-pass");
  $("#monica-score").textContent = "94/100";
  $("#production-label").textContent = "Sample candidate assembled";
  $("#production-image").src = assetPath(selectedLook);
  $("#final-film-image").src = assetPath(selectedLook);
  $("#monica-note").innerHTML = "<span>✓</span><p>Simulation complete. In production, each pass would link to versioned evidence and thresholds.</p>";
  $("#creation-note").textContent = "Simulated · 1 targeted repair · $28.44";
  $("#premiere-button").disabled = false;
  $("#start-production").innerHTML = "<span>✓</span><strong>Simulation complete</strong><small>7 shots · final mix · captions · sample evidence</small>";
  $("#pause-production").disabled = true;
  updateBlockers();
  showToast("The final film is ready");
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
    $("#pace-output").textContent = `${(0.82 + Number(event.target.value) * .0024).toFixed(2)}×`;
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
    $("#approve-film").innerHTML = "<span>✓</span> Approved in prototype";
    $("#final-message").textContent = "Prototype approval recorded. Production export will package MP4, captions, stems and evidence.";
    showToast("Prototype: final approval and export state confirmed");
  });
  $("#repair-film").addEventListener("click", () => {
    $("#final-message").textContent = "Prototype repair state: select a timestamp, inspect references and describe only what should change.";
    showToast("Prototype: targeted repair editor opens here");
  });
  $("#create-another").addEventListener("click", resetFilm);
  $$("[data-open-monica]").forEach((button) => button.addEventListener("click", openMonica));
  $$("[data-close-monica]").forEach((button) => button.addEventListener("click", closeMonica));
  $$("[data-open-command]").forEach((button) => button.addEventListener("click", openCommand));
  $$("[data-close-command]").forEach((button) => button.addEventListener("click", closeCommand));
  $("#command-input").addEventListener("input", (event) => filterCommands(event.target.value));
  $$("[data-command-stage]").forEach((button) => button.addEventListener("click", () => {
    setStage(button.dataset.commandStage);
    closeCommand();
  }));
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openCommand();
    }
    if (event.key === "Escape") {
      if (!$("#command-palette").hidden) closeCommand();
      else if (!$("#look-vault").hidden) closeVault();
      else if (!$("#prompt-sheet").hidden) closePrompt();
      else closeMonica();
    }
    if (event.key === "Tab") {
      const dialog = [
        $("#command-palette [role='dialog']"),
        $("#look-vault [role='dialog']"),
        $("#prompt-sheet [role='dialog']"),
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
updateScriptStats();
updateWorldState();
updateFinalMetadata();
wireEvents();
resetProduction();
setStage("script");
