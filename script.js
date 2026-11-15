/* EarthTrace — vanilla browser application
   Sections: STATE, 3D GLOBE, API, ANALYSIS UI, CHARTS, GUIDE, LEARNING,
   GUIDED DEMOS, AI DISCOVERY, TEMPORAL RESOLUTION, CUAHSI, SAVED RESULTS.
*/

// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------
const API = "";
const state = {
  activeView: "home",
  catalogue: [],
  variables: new Map(),
  selectedDataset: "nasa_power_merra2_monthly",
  selectedVariable: "T2M",
  selectedRegion: null,
  comparisonMode: false,
  activeTab: "overview",
  activeResult: null,
  activeComparison: null,
  lastAnalysisRequest: null,
  activeJob: null,
  guide: { step: 0, answers: {}, selected: null },
  discoverySuggestions: [],
  discoveryMode: "rules_based",
  currentStudy: null,
  studyStep: 0,
  studyPlaying: false,
  panelCollapsed: false,
  isSavedResult: false,
  refreshFailed: false,
  globeReady: false,
  selectedMarker: null,
  chart: null,
  comparisonChart: null,
  timelineRows: [],
};

const PLACES = {
  Cairo: { lat: 30.0444, lon: 31.2357, name: "Cairo, Egypt" },
  Alexandria: { lat: 31.2001, lon: 29.9187, name: "Alexandria, Egypt" },
  Aswan: { lat: 24.0889, lon: 32.8998, name: "Aswan, Egypt" },
  Manaus: { lat: -3.119, lon: -60.0217, name: "Manaus, Brazil" },
  Tokyo: { lat: 35.6762, lon: 139.6503, name: "Tokyo, Japan" },
  Nairobi: { lat: -1.2921, lon: 36.8219, name: "Nairobi, Kenya" },
  Delhi: { lat: 28.6139, lon: 77.209, name: "New Delhi, India" },
  Reykjavik: { lat: 64.1466, lon: -21.9426, name: "Reykjavik, Iceland" },
  California: { lat: 36.7783, lon: -119.4179, name: "California, USA" },
  Amazon: { lat: -3.4653, lon: -62.2159, name: "Amazon region, Brazil" },
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

function toast(message, type = "info", duration = 4200) {
  const stack = $("#toastStack");
  if (!stack) return;
  const node = document.createElement("div");
  node.className = `toast ${type === "error" ? "error" : type === "success" ? "success" : ""}`;
  node.textContent = message;
  stack.appendChild(node);
  window.setTimeout(() => node.remove(), duration);
}

function showModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  const close = modal.querySelector("[data-close]");
  close?.focus();
}
function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.hidden = true;
  if (!$$(".modal-backdrop").some((item) => !item.hidden)) document.body.style.overflow = "";
}

$$('[data-close]').forEach((button) => button.addEventListener("click", () => closeModal(button.dataset.close)));
$$(".modal-backdrop").forEach((backdrop) => backdrop.addEventListener("click", (event) => {
  if (event.target === backdrop) closeModal(backdrop.id);
}));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    const open = $$(".modal-backdrop").find((item) => !item.hidden);
    if (open) closeModal(open.id);
  }
});

// ---------------------------------------------------------------------------
// API — all NASA credentials and remote requests stay on the server.
// ---------------------------------------------------------------------------
async function apiRequest(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const detail = typeof data === "object" ? (data.detail || data.message || JSON.stringify(data)) : data;
    throw new Error(detail || `Request failed (${response.status})`);
  }
  return data;
}

async function initializeApplication() {
  setSystemStatus("checking");
  try {
    const [health, catalog] = await Promise.all([
      apiRequest("/api/health"),
      apiRequest("/api/catalog/variables"),
    ]);
    state.catalogue = catalog.variables || [];
    state.variables = new Map(state.catalogue.map((item) => [item.id, item]));
    populateVariableSelect();
    renderVariableCards();
    setSystemStatus(health.status === "ok" ? "online" : "offline");
    const count = state.catalogue.length.toString().padStart(2, "0");
    $("#heroVariableCount").textContent = count;
    const latestPublishedYear = new Date().getUTCFullYear() - 1;
    $("#endYear").max = String(latestPublishedYear);
    if (Number($("#endYear").value) > latestPublishedYear) $("#endYear").value = String(latestPublishedYear);
    $("#catalogCount").textContent = `${count} VARIABLES / 01 DATA PATH`;
  } catch (error) {
    setSystemStatus("offline");
    toast(`Backend not reachable: ${error.message}. Start FastAPI and reload.`, "error", 7000);
    renderCatalogueFallback();
  }
}

function setSystemStatus(mode) {
  const label = $("#apiStatusText");
  const parent = label?.closest(".system-status");
  if (!label || !parent) return;
  parent.classList.toggle("offline", mode === "offline");
  label.textContent = mode === "online" ? "API CONNECTED" : mode === "checking" ? "CHECKING SYSTEM" : "API OFFLINE";
}

function renderCatalogueFallback() {
  const fallback = [
    { id: "T2M", name: "Near-surface air temperature", unit: "°C", simple: "Monthly near-surface air temperature." },
    { id: "PRECTOTCORR", name: "Corrected precipitation rate", unit: "mm/day", simple: "Monthly mean corrected precipitation rate." },
    { id: "RH2M", name: "Relative humidity at 2 metres", unit: "%", simple: "Monthly relative humidity estimate." },
    { id: "WS10M", name: "Wind speed at 10 metres", unit: "m/s", simple: "Monthly average 10-metre wind speed." },
  ];
  state.catalogue = fallback;
  state.variables = new Map(fallback.map((item) => [item.id, item]));
  populateVariableSelect();
  renderVariableCards();
}

function populateVariableSelect() {
  const select = $("#variableSelect");
  if (!select) return;
  select.innerHTML = state.catalogue.map((item) => `<option value="${esc(item.id)}">${esc(item.name)} · ${esc(item.unit)}</option>`).join("");
  if (state.variables.has(state.selectedVariable)) select.value = state.selectedVariable;
  updateVariableContext();
}

function updateVariableContext() {
  const variable = state.variables.get(state.selectedVariable);
  if (!variable) return;
  $("#variableDescription").textContent = variable.simple || variable.why || "A supported NASA POWER monthly variable.";
}

function renderVariableCards() {
  const container = $("#variableCards");
  if (!container) return;
  container.innerHTML = state.catalogue.map((variable) => `
    <article class="variable-card" role="button" tabindex="0" data-variable-card="${esc(variable.id)}">
      <span class="var-code">${esc(variable.id)}</span>
      <h4>${esc(variable.name)}</h4>
      <p>NASA POWER · monthly point series</p>
      <span class="var-unit">UNIT / ${esc(variable.unit)}</span>
    </article>`).join("");
  $$('[data-variable-card]', container).forEach((card) => {
    const choose = () => {
      state.selectedVariable = card.dataset.variableCard;
      $("#variableSelect").value = state.selectedVariable;
      updateVariableContext();
      showLearningCard(state.selectedVariable);
    };
    card.addEventListener("click", choose);
    card.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(); } });
  });
}

// ---------------------------------------------------------------------------
// 3D GLOBE — initialized on first Explorer open; static globe remains fallback.
// ---------------------------------------------------------------------------
let THREE = null;
let OrbitControls = null;
let globeRenderer = null;
let globeScene = null;
let globeCamera = null;
let globeControls = null;
let earthMesh = null;
let markerGroup = null;
let raycaster = null;
let pointerNdc = null;
let cameraDestination = null;
let animationFrame = null;
let lastPointerDown = null;

async function initializeGlobe() {
  if (state.globeReady) return;
  const canvas = $("#workspaceCanvas");
  const host = canvas?.parentElement;
  if (!canvas || !host || host.getBoundingClientRect().width < 20) return;
  try {
    THREE = await import("three");
    const controlsModule = await import("three/addons/controls/OrbitControls.js");
    OrbitControls = controlsModule.OrbitControls;
    globeRenderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
    globeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
    globeRenderer.outputColorSpace = THREE.SRGBColorSpace;
    globeRenderer.setClearColor(0x000000, 0);
    globeScene = new THREE.Scene();
    globeCamera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    globeCamera.position.set(0, 0, 4.65);
    globeControls = new OrbitControls(globeCamera, globeRenderer.domElement);
    globeControls.enableDamping = true;
    globeControls.dampingFactor = 0.045;
    globeControls.enablePan = false;
    globeControls.minDistance = 2.65;
    globeControls.maxDistance = 6.3;
    globeControls.rotateSpeed = 0.48;
    globeControls.zoomSpeed = 0.62;

    const ambient = new THREE.AmbientLight(0x92b6c7, 0.8);
    globeScene.add(ambient);
    const sunlight = new THREE.DirectionalLight(0xffd6a2, 2.4);
    sunlight.position.set(4, 2.2, 4.5);
    globeScene.add(sunlight);
    const fill = new THREE.DirectionalLight(0x2b759b, 0.38);
    fill.position.set(-4, -1, -3);
    globeScene.add(fill);

    const earthGeometry = new THREE.SphereGeometry(1.45, 96, 96);
    const earthMaterial = new THREE.MeshPhongMaterial({ color: 0x3b7995, shininess: 13, specular: new THREE.Color(0x20495e) });
    earthMesh = new THREE.Mesh(earthGeometry, earthMaterial);
    globeScene.add(earthMesh);

    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(
      "https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg",
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        earthMaterial.map = texture;
        earthMaterial.color.set(0xffffff);
        earthMaterial.needsUpdate = true;
        $(".small-fallback")?.classList.add("texture-loaded");
      },
      undefined,
      () => toast("Earth texture could not be loaded; the globe remains interactive with a simplified surface.", "info", 5500),
    );

    const atmosphereGeometry = new THREE.SphereGeometry(1.49, 80, 80);
    const atmosphereMaterial = new THREE.MeshBasicMaterial({ color: 0x4aa3c5, transparent: true, opacity: 0.11, side: THREE.BackSide, blending: THREE.AdditiveBlending });
    globeScene.add(new THREE.Mesh(atmosphereGeometry, atmosphereMaterial));
    markerGroup = new THREE.Group();
    globeScene.add(markerGroup);
    addStarField();
    raycaster = new THREE.Raycaster();
    pointerNdc = new THREE.Vector2();

    resizeGlobe();
    const resizeObserver = new ResizeObserver(resizeGlobe);
    resizeObserver.observe(host);
    window.addEventListener("resize", resizeGlobe);
    canvas.addEventListener("pointerdown", (event) => { lastPointerDown = { x: event.clientX, y: event.clientY }; });
    canvas.addEventListener("pointerup", (event) => {
      if (!lastPointerDown) return;
      const distance = Math.hypot(event.clientX - lastPointerDown.x, event.clientY - lastPointerDown.y);
      lastPointerDown = null;
      if (distance < 5) handleGlobeClick(event);
    });
    state.globeReady = true;
    $(".small-fallback")?.setAttribute("hidden", "hidden");
    if (state.selectedRegion) {
      addSelectionMarker(state.selectedRegion);
      focusGlobeOn(state.selectedRegion);
    }
    animateGlobe();
  } catch (error) {
    console.warn("Three.js could not be initialized", error);
    toast("3D rendering is unavailable in this browser. Use place search to select a point.", "error", 7000);
    $(".small-fallback")?.removeAttribute("hidden");
  }
}

function addStarField() {
  if (!THREE || !globeScene) return;
  const positions = [];
  for (let i = 0; i < 950; i += 1) {
    const radius = 5 + Math.random() * 9;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions.push(radius * Math.sin(phi) * Math.cos(theta), radius * Math.sin(phi) * Math.sin(theta), radius * Math.cos(phi));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color: 0x8099b0, size: 0.012, transparent: true, opacity: 0.63, sizeAttenuation: true });
  globeScene.add(new THREE.Points(geometry, material));
}

function resizeGlobe() {
  if (!globeRenderer || !globeCamera) return;
  const host = $("#workspaceCanvas")?.parentElement;
  if (!host) return;
  const rect = host.getBoundingClientRect();
  if (rect.width < 10 || rect.height < 10) return;
  globeRenderer.setSize(rect.width, rect.height, false);
  globeCamera.aspect = rect.width / rect.height;
  globeCamera.updateProjectionMatrix();
}

function animateGlobe() {
  if (!globeRenderer || !globeScene || !globeCamera) return;
  animationFrame = requestAnimationFrame(animateGlobe);
  if (earthMesh && !state.selectedRegion) earthMesh.rotation.y += 0.00022;
  if (cameraDestination) {
    globeCamera.position.lerp(cameraDestination, 0.035);
    if (globeCamera.position.distanceTo(cameraDestination) < 0.018) cameraDestination = null;
  }
  globeControls?.update();
  globeRenderer.render(globeScene, globeCamera);
}

function pointToVector(lat, lon, radius = 1.47) {
  const latitude = THREE.MathUtils.degToRad(lat);
  const longitude = THREE.MathUtils.degToRad(lon);
  return new THREE.Vector3(
    radius * Math.cos(latitude) * Math.cos(longitude),
    radius * Math.sin(latitude),
    -radius * Math.cos(latitude) * Math.sin(longitude),
  );
}

function addSelectionMarker(region) {
  if (!THREE || !markerGroup) return;
  markerGroup.clear();
  const position = pointToVector(region.lat, region.lon, 1.475);
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 20, 20),
    new THREE.MeshBasicMaterial({ color: 0xf2a45b }),
  );
  core.position.copy(position);
  markerGroup.add(core);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.05, 0.065, 48),
    new THREE.MeshBasicMaterial({ color: 0x69c9d0, transparent: true, opacity: 0.95, side: THREE.DoubleSide }),
  );
  ring.position.copy(position.clone().multiplyScalar(1.012));
  ring.lookAt(position.clone().multiplyScalar(2.2));
  markerGroup.add(ring);
  const beam = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([position.clone().multiplyScalar(1.0), position.clone().multiplyScalar(1.2)]),
    new THREE.LineBasicMaterial({ color: 0xf2a45b, transparent: true, opacity: 0.75 }),
  );
  markerGroup.add(beam);
}

function addComparisonMarkers(regionA, regionB) {
  if (!THREE || !markerGroup) return;
  markerGroup.clear();
  [regionA, regionB].forEach((region, index) => {
    const position = pointToVector(region.latitude, region.longitude, 1.475);
    const color = index === 0 ? 0x69c9d0 : 0xf2a45b;
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.034, 18, 18), new THREE.MeshBasicMaterial({ color }));
    core.position.copy(position);
    markerGroup.add(core);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.063, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    ring.position.copy(position.clone().multiplyScalar(1.012));
    ring.lookAt(position.clone().multiplyScalar(2.2));
    markerGroup.add(ring);
  });
}

function focusGlobeOn(region) {
  if (!THREE || !globeCamera || !globeControls) return;
  const surface = pointToVector(region.lat, region.lon, 1);
  cameraDestination = surface.clone().normalize().multiplyScalar(4.2);
  globeControls.target.set(0, 0, 0);
}

function handleGlobeClick(event) {
  if (!globeRenderer || !earthMesh || !raycaster) return;
  const rect = globeRenderer.domElement.getBoundingClientRect();
  pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNdc, globeCamera);
  const intersections = raycaster.intersectObject(earthMesh, false);
  if (!intersections.length) return;
  const local = earthMesh.worldToLocal(intersections[0].point.clone()).normalize();
  const lat = THREE.MathUtils.radToDeg(Math.asin(local.y));
  const lon = THREE.MathUtils.radToDeg(Math.atan2(-local.z, local.x));
  const region = { type: "Point", lat: Number(lat.toFixed(4)), lon: Number(lon.toFixed(4)), name: "Selected point" };
  selectRegion(region, { focus: false });
  const hint = $("#selectionTooltip");
  if (hint) {
    hint.textContent = `${region.lat.toFixed(2)}° LAT / ${region.lon.toFixed(2)}° LNG`;
    hint.hidden = false;
    window.setTimeout(() => { hint.hidden = true; }, 2200);
  }
}

function selectRegion(region, options = {}) {
  const isComparisonPick = Boolean(state.comparisonMode && state.activeResult);
  const samePoint = state.selectedRegion && Math.abs(state.selectedRegion.lat - Number(region.lat)) < 0.0001 && Math.abs(state.selectedRegion.lon - Number(region.lon)) < 0.0001;
  if (!isComparisonPick && state.activeResult && !samePoint) {
    state.activeResult = null;
    state.activeComparison = null;
    state.lastAnalysisRequest = null;
    state.isSavedResult = false;
    state.refreshFailed = false;
    setAnalysisPanelVisible(false);
  }
  state.selectedRegion = { type: "Point", lat: Number(region.lat), lon: Number(region.lon), name: region.name || "Selected point" };
  $("#selectedLocationName").textContent = state.selectedRegion.name;
  $("#selectedCoordinates").textContent = `${state.selectedRegion.lat.toFixed(4)}°, ${state.selectedRegion.lon.toFixed(4)}°`;
  $("#globeCoordinateReadout").textContent = `LAT ${state.selectedRegion.lat.toFixed(4)}°  LNG ${state.selectedRegion.lon.toFixed(4)}°`;
  $("#analysisRegionTitle").textContent = state.selectedRegion.name;
  $("#analysisVariableSubtitle").textContent = state.variables.get(state.selectedVariable)?.name || "Selected variable";
  addSelectionMarker(state.selectedRegion);
  if (options.focus !== false) focusGlobeOn(state.selectedRegion);
  if (state.comparisonMode && state.activeResult) {
    state.comparisonMode = false;
    runComparison(state.selectedRegion);
  }
}

// ---------------------------------------------------------------------------
// EXPLORER CONTROLS AND REGION SEARCH
// ---------------------------------------------------------------------------
function openExplorer() {
  const section = $("#explorer");
  section.hidden = false;
  state.activeView = "explorer";
  section.scrollIntoView({ behavior: "smooth", block: "start" });
  window.setTimeout(() => { initializeGlobe(); resizeGlobe(); }, 260);
}

function openDataDetective() {
  $("#discover")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

$("#startExploring")?.addEventListener("click", () => $("#introduction")?.scrollIntoView({ behavior: "smooth", block: "start" }));
$("#openDiscoverFromIntro")?.addEventListener("click", openDataDetective);
$("#openExplorerFromDiscover")?.addEventListener("click", openExplorer);
$("#variableSelect")?.addEventListener("change", (event) => {
  state.selectedVariable = event.target.value;
  updateVariableContext();
  $("#analysisVariableSubtitle").textContent = state.variables.get(state.selectedVariable)?.name || "Selected variable";
  state.activeResult = null;
  state.activeComparison = null;
  state.isSavedResult = false;
  state.refreshFailed = false;
  setAnalysisPanelVisible(false);
  renderEmptyAnalysis();
});
$("#learnVariable")?.addEventListener("click", () => showLearningCard(state.selectedVariable));
$("#resetGlobe")?.addEventListener("click", () => {
  if (!globeCamera || !globeControls) return;
  cameraDestination = new THREE.Vector3(0, 0, 4.65);
  globeControls.reset();
  toast("Globe view reset.");
});
$("#locateMe")?.addEventListener("click", () => {
  if (state.selectedRegion) focusGlobeOn(state.selectedRegion);
  else toast("Search for a city or click a point on Earth first.");
});

function resolvePlace(input) {
  const query = input.trim();
  if (!query) return null;
  const match = Object.entries(PLACES).find(([key, value]) => key.toLowerCase() === query.toLowerCase() || value.name.toLowerCase() === query.toLowerCase());
  if (match) return match[1];
  const coords = query.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (coords) {
    const lat = Number(coords[1]);
    const lon = Number(coords[2]);
    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) return { lat, lon, name: "Entered coordinates" };
  }
  return null;
}

function searchPlace() {
  const query = $("#placeSearch").value;
  const place = resolvePlace(query);
  if (!place) {
    toast("Choose Cairo, Alexandria, Aswan, Manaus or another listed city; otherwise enter latitude, longitude.", "error");
    return;
  }
  selectRegion({ ...place, type: "Point" });
  $("#placeSearch").value = "";
}
$("#placeSearchButton")?.addEventListener("click", searchPlace);
$("#placeSearch")?.addEventListener("keydown", (event) => { if (event.key === "Enter") searchPlace(); });
$$(".preset-chip").forEach((button) => button.addEventListener("click", () => {
  const place = PLACES[button.dataset.place];
  if (place) selectRegion({ ...place, type: "Point" });
}));

// ---------------------------------------------------------------------------
// ANALYSIS JOBS AND PROGRESS
// ---------------------------------------------------------------------------
function currentAnalysisRequest(regionOverride = null) {
  const start = Number($("#startYear").value);
  const end = Number($("#endYear").value);
  const latestPublishedYear = new Date().getUTCFullYear() - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1981 || end > latestPublishedYear || end < start) {
    throw new Error(`Choose a valid period between 1981 and ${latestPublishedYear}, with the end year on or after the start year.`);
  }
  const region = regionOverride || state.selectedRegion;
  if (!region) throw new Error("Select a point on the globe or search for a place first.");
  return {
    dataset_id: state.selectedDataset,
    variable_id: state.selectedVariable,
    region: { type: "Point", lat: region.lat, lon: region.lon, name: region.name },
    start_date: `${start}-01-01`,
    end_date: `${end}-12-01`,
    temporal_frequency: "monthly",
    seasonality: "monthly_anomalies",
    significance_level: 0.05,
    force_refresh: false,
  };
}

function setProgress(status, message = "") {
  const panel = $("#progressPanel");
  panel.hidden = false;
  const stages = ["queued", "retrieving", "quality_control", "analyzing", "completed"];
  const labels = {
    queued: "Preparing request", retrieving: "Retrieving NASA data", quality_control: "Running quality checks",
    analyzing: "Testing trend", completed: "Analysis complete",
  };
  const percents = { queued: 4, retrieving: 24, quality_control: 57, analyzing: 82, completed: 100 };
  $("#progressTitle").textContent = message || labels[status] || "Working";
  $("#progressPercent").textContent = status === "retrieving" || status === "quality_control" || status === "analyzing" ? "LIVE" : `${percents[status] || 0}%`;
  $("#progressBar").style.width = `${percents[status] || 4}%`;
  const stageNames = { retrieving: "retrieving", quality_control: "quality", analyzing: "analyzing", completed: "completed" };
  const active = stageNames[status];
  const order = ["retrieving", "quality", "analyzing", "completed"];
  $$(".progress-stages span").forEach((node) => {
    const index = order.indexOf(node.dataset.stage);
    const current = order.indexOf(active);
    node.classList.toggle("active", index >= 0 && index <= current);
  });
}

async function runAnalysis(regionOverride = null, requestOverride = null) {
  let request;
  try { request = requestOverride || currentAnalysisRequest(regionOverride); }
  catch (error) { toast(error.message, "error"); return; }
  const previous = {
    result: state.activeResult,
    comparison: state.activeComparison,
    isSavedResult: state.isSavedResult,
    refreshFailed: state.refreshFailed,
    request: state.lastAnalysisRequest,
  };
  if (!state.globeReady) initializeGlobe();
  state.lastAnalysisRequest = request;
  state.activeComparison = null;
  state.activeResult = null;
  state.activeTab = "overview";
  setActiveTab("overview");
  setAnalysisPanelVisible(true);
  renderLoadingAnalysis();
  $("#sourceState").className = "source-state";
  $("#sourceState").innerHTML = "<i></i> REQUESTING NASA";
  $("#analysisDateStamp").textContent = "LIVE REQUEST";
  setProgress("queued", "Preparing a NASA POWER request");
  $("#runAnalysis").disabled = true;
  try {
    const created = await apiRequest("/api/analysis/jobs", { method: "POST", body: JSON.stringify(request) });
    state.activeJob = created.job_id;
    let job = null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      await sleep(1150);
      job = await apiRequest(`/api/analysis/jobs/${created.job_id}`);
      setProgress(job.status, job.message || "");
      if (job.status === "completed" || job.status === "failed") break;
    }
    if (!job || job.status !== "completed") {
      throw new Error(job?.error || "The analysis did not finish. The result was not fabricated.");
    }
    const result = await apiRequest(`/api/analysis/results/${job.result_id}`);
    state.activeResult = result;
    state.lastAnalysisRequest = request;
    state.isSavedResult = false;
    state.refreshFailed = false;
    const servedFromCache = result.source_state === "cached_nasa_response";
    $("#sourceState").className = servedFromCache ? "source-state saved" : "source-state live";
    $("#sourceState").innerHTML = servedFromCache ? "<i></i> NASA DATA · CACHED" : "<i></i> LIVE FROM NASA";
    $("#analysisDateStamp").textContent = new Date(result.created_at).toLocaleDateString();
    renderAnalysis();
    setAnalysisPanelVisible(!$("#analysisPanel").hidden);
    toast("NASA data retrieved and analysis completed.", "success");
  } catch (error) {
    if (request.force_refresh && previous.result) {
      state.activeResult = previous.result;
      state.activeComparison = previous.comparison;
      state.isSavedResult = previous.isSavedResult;
      state.refreshFailed = true;
      state.lastAnalysisRequest = previous.request || { ...request, force_refresh: false };
      $("#sourceState").className = "source-state saved";
      $("#sourceState").innerHTML = "<i></i> PREVIOUS RESULT · NOT REFRESHED";
      $("#analysisDateStamp").textContent = new Date(previous.result.created_at).toLocaleDateString();
      renderAnalysis();
      setAnalysisPanelVisible(!$("#analysisPanel").hidden);
      toast(`NASA refresh failed. The previous analysis is still shown with its original timestamp. ${error.message}`, "error", 8500);
    } else {
      $("#sourceState").className = "source-state";
      $("#sourceState").innerHTML = "<i></i> REQUEST FAILED";
      renderAnalysisError(error.message);
      toast(error.message, "error", 7000);
    }
  } finally {
    $("#runAnalysis").disabled = false;
  }
}
$("#runAnalysis")?.addEventListener("click", () => runAnalysis());

function renderLoadingAnalysis() {
  $("#analysisContent").innerHTML = `<div class="empty-analysis"><div class="empty-orbit">◌</div><h4>Following the signal.</h4><p>EarthTrace is retrieving the requested NASA series, checking its coverage, and preparing the statistical tests.</p><div class="empty-steps"><span>RETRIEVE</span><span>CHECK</span><span>ANALYZE</span></div></div>`;
}
function renderAnalysisError(message) {
  $("#analysisContent").innerHTML = `<div class="empty-analysis"><div class="empty-orbit" style="color:#d28b76;border-color:rgba(210,139,118,.35)">!</div><h4>No result was produced.</h4><p>${esc(message)}</p><div class="empty-steps"><span>CHECK INPUT</span><span>CHECK NETWORK</span><span>RETRY</span></div></div>`;
}
function renderEmptyAnalysis() {
  $("#analysisContent").innerHTML = `<div class="empty-analysis"><div class="empty-orbit">◎</div><h4>Your evidence starts here.</h4><p>Choose a variable, select a point on Earth, and run an analysis to retrieve NASA data.</p><div class="empty-steps"><span>01 / SELECT</span><span>02 / RETRIEVE</span><span>03 / TEST</span></div></div>`;
}

// ---------------------------------------------------------------------------
// ANALYSIS UI — tabs, evidence, comparisons, saved result actions.
// ---------------------------------------------------------------------------
function setActiveTab(tab) {
  state.activeTab = tab;
  $$(".analysis-tab").forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  if (state.activeResult) renderAnalysis();
}
$$(".analysis-tab").forEach((button) => button.addEventListener("click", () => setActiveTab(button.dataset.tab)));

function classificationLabel(value) {
  const labels = {
    significant_increasing_trend: "SIGNIFICANT INCREASE",
    significant_decreasing_trend: "SIGNIFICANT DECREASE",
    trend_detected_not_statistically_significant: "TREND · NOT SIGNIFICANT",
    no_clear_trend_detected: "NO CLEAR TREND",
    insufficient_data: "INSUFFICIENT DATA",
    exploratory_result: "EXPLORATORY · SHORT RECORD",
  };
  return labels[value] || "ANALYSIS COMPLETE";
}
function numberFormat(value, decimals = 3) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: 0 });
}

function renderAnalysis() {
  if (!state.activeResult) return;
  const result = state.activeResult;
  const panel = $("#analysisContent");
  if (state.activeTab === "overview") panel.innerHTML = renderOverview(result);
  else if (state.activeTab === "series") panel.innerHTML = renderSeriesPanel(result);
  else if (state.activeTab === "statistics") panel.innerHTML = renderStatistics(result);
  else if (state.activeTab === "method") panel.innerHTML = renderEvidence(result);
  else panel.innerHTML = renderOverview(result);
  attachAnalysisActions();
  if (state.activeTab === "series") requestAnimationFrame(() => renderSeriesChart(result));
  if (state.activeTab === "overview") requestAnimationFrame(() => setupReportTimeline(result));
}

function renderOverview(result) {
  const trend = result.trend;
  const quality = result.quality;
  const isSignificant = ["significant_increasing_trend", "significant_decreasing_trend"].includes(trend.classification);
  const badgeClass = isSignificant ? "" : ["trend_detected_not_statistically_significant", "exploratory_result"].includes(trend.classification) ? "warning" : "neutral";
  const ci = trend.confidence_interval_95 || [];
  const region = result.region;
  const series = result.series || [];
  const first = series[0];
  const last = series[series.length - 1];
  const spanYears = first && last ? Math.max(0, (Date.parse(last.date) - Date.parse(first.date)) / (365.2425 * 86400000)) : 0;
  const estimatedPeriodChange = Number.isFinite(Number(trend.slope_per_year)) ? Number(trend.slope_per_year) * spanYears : null;
  const observedChange = first && last ? Number(last.value) - Number(first.value) : null;
  const savedLabel = state.refreshFailed
    ? `<span class="result-badge warning">PREVIOUS RESULT · NOT REFRESHED</span>`
    : state.isSavedResult ? `<span class="result-badge warning">SAVED RESULT · NOT REFRESHED</span>` : "";
  return `
    ${savedLabel}
    <div class="overview-intro-row"><span class="result-badge ${badgeClass}">${esc(classificationLabel(trend.classification))}</span><span class="overview-period">OBSERVED ${esc(result.period.actual_first_observation.slice(0,7))} — ${esc(result.period.actual_last_observation.slice(0,7))}</span></div>
    <div class="metric-grid report-metrics">
      <div class="metric-card"><label>TREND / YEAR</label><strong>${numberFormat(trend.slope_per_year, 4)}</strong><small>${esc(result.variable.unit)} / year</small></div>
      <div class="metric-card metric-card-highlight"><label>ESTIMATED CHANGE / RECORD</label><strong>${numberFormat(estimatedPeriodChange, 4)}</strong><small>${esc(result.variable.unit)} across ${numberFormat(spanYears, 1)} years · slope-based</small></div>
      <div class="metric-card"><label>OBSERVED FIRST → LAST</label><strong>${numberFormat(observedChange, 4)}</strong><small>${esc(result.variable.unit)} · actual endpoints</small></div>
      <div class="metric-card"><label>P-VALUE</label><strong>${numberFormat(trend.p_value, 4)}</strong><small>Threshold ${numberFormat(trend.significance_level, 2)}</small></div>
      <div class="metric-card"><label>95% CONFIDENCE INTERVAL</label><strong>${numberFormat(ci[0], 3)} to ${numberFormat(ci[1], 3)}</strong><small>${esc(result.variable.unit)} / year</small></div>
      <div class="metric-card"><label>TEMPORAL COVERAGE</label><strong>${numberFormat(quality.temporal_coverage_percent, 1)}%</strong><small>${quality.valid_observations} / ${quality.expected_observations} months</small></div>
    </div>
    <div class="report-interpretation"><div class="report-interpretation-marker">✳</div><div><strong>What the evidence says</strong><p>${esc(result.interpretation)}</p><small>The estimated period change is calculated from the fitted annual slope and the observed record length. The observed first-to-last difference is shown separately; neither establishes the cause of change.</small></div></div>
    <div class="report-context-grid">
      <div class="report-context-item"><span>REGION / POINT</span><strong>${esc(region.name)}</strong><small>${numberFormat(region.latitude, 4)}° LAT · ${numberFormat(region.longitude, 4)}° LNG</small></div>
      <div class="report-context-item"><span>ROBUST THEIL–SEN SLOPE</span><strong>${numberFormat(result.theil_sen.slope_per_decade, 4)} / decade</strong><small>Robust estimate · ${esc(result.variable.unit)}</small></div>
      <div class="report-context-item"><span>SEASONAL MANN–KENDALL</span><strong>τ ${numberFormat(result.mann_kendall.tau, 3)}</strong><small>p = ${numberFormat(result.mann_kendall.p_value, 4)}</small></div>
      <div class="report-context-item"><span>DATA SOURCE</span><strong>NASA POWER</strong><small>${esc(result.dataset.source_family)} · monthly point series</small></div>
    </div>
    ${renderReportTimelineMarkup(result)}
    ${state.activeComparison ? renderComparisonSummary(state.activeComparison) : ""}
    <div class="panel-action-row report-actions">
      <button class="small-action" data-action="series">Open full time-series analysis ↗</button>
      ${state.activeComparison ? `<button class="small-action" data-action="compare-chart">View comparison chart ↗</button>` : `<button class="small-action" data-action="compare">Compare with another point +</button>`}
      <button class="small-action" data-action="extend">Try a longer period ↗</button>
      <button class="small-action" data-action="refresh">Refresh from NASA ↻</button>
    </div>`;
}

function renderReportTimelineMarkup(result) {
  const comparison = Boolean(state.activeComparison);
  const subtitle = comparison
    ? `Move through the shared monthly timeline to inspect both points at the same timestamp.`
    : `Move the marker to inspect the actual NASA value recorded for a particular month.`;
  return `
    <section class="report-timeline" aria-label="Interactive monthly data timeline">
      <div class="timeline-heading"><div><span class="panel-kicker">EXPLORE THE RECORD</span><h4>Monthly data <em>timeline.</em></h4><p>${subtitle}</p></div><span class="timeline-frequency"><i></i> MONTHLY OBSERVATIONS</span></div>
      <div class="timeline-graph-wrap"><svg id="reportTimelineSvg" class="report-timeline-svg" viewBox="0 0 1000 190" role="img" aria-label="Monthly time-series values over the selected period"><text x="500" y="95" text-anchor="middle">Preparing timeline…</text></svg></div>
      <div class="timeline-scrubber-row"><span id="timelineStartLabel">${esc(result.period.actual_first_observation.slice(0,7))}</span><input id="reportTimelineSlider" type="range" min="0" max="${Math.max(0, result.series.length-1)}" value="${Math.max(0, result.series.length-1)}" step="1" aria-label="Select a monthly observation" /><span id="timelineEndLabel">${esc(result.period.actual_last_observation.slice(0,7))}</span></div>
      <div class="timeline-selected-row"><div><span class="panel-kicker">SELECTED OBSERVATION</span><strong id="timelineSelectedDate">—</strong><small id="timelineSelectedIndex">—</small></div><div class="timeline-readouts" id="timelineReadouts"></div></div>
      <p class="timeline-note">The slider follows observations returned by the selected product. Missing months are not filled or interpolated. Values are source observations; anomaly values are shown separately when available.</p>
    </section>`;
}

function renderComparisonSummary(comparison) {
  const a = comparison.region_a;
  const b = comparison.region_b;
  const diff = comparison.slope_difference_test;
  const coord = (region) => `${numberFormat(region.latitude, 3)}°, ${numberFormat(region.longitude, 3)}°`;
  const rows = [
    ["Trend / year", `${numberFormat(a.trend.slope_per_year, 5)} ${a.variable.unit}`, `${numberFormat(b.trend.slope_per_year, 5)} ${b.variable.unit}`, `${numberFormat(diff.difference_per_year, 5)} ${a.variable.unit}/year`],
    ["Trend / decade", `${numberFormat(a.trend.slope_per_decade, 4)} ${a.variable.unit}`, `${numberFormat(b.trend.slope_per_decade, 4)} ${b.variable.unit}`, "See slope difference test"],
    ["OLS-HAC p-value", numberFormat(a.trend.p_value, 5), numberFormat(b.trend.p_value, 5), `Difference p = ${numberFormat(diff.p_value, 5)}`],
    ["95% slope interval", `[${numberFormat(a.trend.confidence_interval_95[0], 4)}, ${numberFormat(a.trend.confidence_interval_95[1], 4)}]`, `[${numberFormat(b.trend.confidence_interval_95[0], 4)}, ${numberFormat(b.trend.confidence_interval_95[1], 4)}]`, `[${numberFormat(diff.confidence_interval_95[0], 4)}, ${numberFormat(diff.confidence_interval_95[1], 4)}]`],
    ["Mann–Kendall τ", numberFormat(a.mann_kendall.tau, 4), numberFormat(b.mann_kendall.tau, 4), "Separate seasonal tests"],
    ["Valid observations", `${a.quality.valid_observations} / ${a.quality.expected_observations}`, `${b.quality.valid_observations} / ${b.quality.expected_observations}`, "Same requested period"],
    ["Temporal coverage", `${numberFormat(a.quality.temporal_coverage_percent, 1)}%`, `${numberFormat(b.quality.temporal_coverage_percent, 1)}%`, "Coverage may differ by point"],
  ];
  const body = rows.map((row) => `<tr><th scope="row">${esc(row[0])}</th><td>${esc(row[1])}</td><td>${esc(row[2])}</td><td>${esc(row[3])}</td></tr>`).join("");
  return `<section class="comparison-report"><div class="comparison-report-heading"><div><span class="panel-kicker">SAME VARIABLE · SAME PERIOD · SAME METHOD</span><h4>Two-point <em>comparison.</em></h4><p>Read the two estimates side by side. The fourth column reports the direct difference-in-slopes test where applicable.</p></div><div class="comparison-legend"><span class="point-key point-a">A</span><span class="point-key point-b">B</span></div></div>
    <div class="comparison-table-wrap"><table class="comparison-table"><thead><tr><th>INDICATOR</th><th><span class="comparison-col-title"><i class="point-dot point-dot-a"></i> POINT A</span><strong>${esc(a.region.name)}</strong><small>${coord(a.region)}</small></th><th><span class="comparison-col-title"><i class="point-dot point-dot-b"></i> POINT B</span><strong>${esc(b.region.name)}</strong><small>${coord(b.region)}</small></th><th>DIFFERENCE / CONTEXT</th></tr></thead><tbody>${body}</tbody></table></div>
    <div class="comparison-test-card"><span class="panel-kicker">DIRECT SLOPE-DIFFERENCE TEST</span><strong>${diff.statistically_different_at_0_05 ? "The fitted slopes are statistically distinguishable at α = 0.05." : "The fitted slopes are not statistically distinguishable at α = 0.05."}</strong><p>${esc(diff.description)} Difference: ${numberFormat(diff.difference_per_year, 5)} ${esc(a.variable.unit)}/year · 95% interval [${numberFormat(diff.confidence_interval_95[0], 5)}, ${numberFormat(diff.confidence_interval_95[1], 5)}] · p = ${numberFormat(diff.p_value, 5)}.</p><small>Do not infer a difference merely from one point being significant and the other not. This table uses the direct test returned by the comparison endpoint.</small></div></section>`;
}

function buildTimelineRows() {
  if (!state.activeComparison) {
    return (state.activeResult?.series || []).map((item) => ({
      date: item.date,
      a: item.value == null ? null : Number(item.value),
      anomalyA: item.anomaly == null ? null : Number(item.anomaly),
      b: null,
      anomalyB: null,
    }));
  }
  const a = state.activeComparison.region_a.series || [];
  const b = state.activeComparison.region_b.series || [];
  const byDate = new Map();
  a.forEach((item) => byDate.set(item.date.slice(0, 7), {
    date: item.date,
    a: item.value == null ? null : Number(item.value),
    anomalyA: item.anomaly == null ? null : Number(item.anomaly),
    b: null,
    anomalyB: null,
  }));
  b.forEach((item) => {
    const key = item.date.slice(0, 7);
    const existing = byDate.get(key) || { date: item.date, a: null, anomalyA: null, b: null, anomalyB: null };
    existing.b = item.value == null ? null : Number(item.value);
    existing.anomalyB = item.anomaly == null ? null : Number(item.anomaly);
    byDate.set(key, existing);
  });
  return [...byDate.values()].sort((x, y) => x.date.localeCompare(y.date));
}

function setupReportTimeline(result) {
  const svg = $("#reportTimelineSvg");
  const slider = $("#reportTimelineSlider");
  if (!svg || !slider) return;
  state.timelineRows = buildTimelineRows();
  const rows = state.timelineRows;
  if (!rows.length) {
    svg.innerHTML = `<text x="500" y="95" text-anchor="middle">No valid monthly observations were returned.</text>`;
    slider.disabled = true;
    return;
  }
  slider.max = String(rows.length - 1);
  slider.value = String(rows.length - 1);
  $("#timelineStartLabel").textContent = rows[0].date.slice(0, 7);
  $("#timelineEndLabel").textContent = rows[rows.length - 1].date.slice(0, 7);
  const values = rows.flatMap((row) => [row.a, row.b]).filter((value) => Number.isFinite(value));
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 1e-12) { min -= 0.5; max += 0.5; }
  const xAt = (index) => 34 + (rows.length === 1 ? 0 : index / (rows.length - 1)) * 932;
  const yAt = (value) => 150 - ((value - min) / (max - min)) * 112;
  const pathFor = (key) => rows.reduce((path, row, index) => {
    const value = row[key];
    if (!Number.isFinite(value)) return path;
    return `${path}${path ? " L" : "M"}${xAt(index).toFixed(2)} ${yAt(value).toFixed(2)}`;
  }, "");
  const grid = [38, 94, 150].map((y) => `<line class="timeline-gridline" x1="30" y1="${y}" x2="970" y2="${y}"/>`).join("");
  const compare = Boolean(state.activeComparison);
  const pathA = pathFor("a");
  const pathB = compare ? pathFor("b") : "";
  svg.innerHTML = `<defs><linearGradient id="timelineAreaGradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#69c9d0" stop-opacity=".28"/><stop offset="1" stop-color="#69c9d0" stop-opacity="0"/></linearGradient></defs>${grid}<path class="timeline-area" d="${pathA} L 966 150 L 34 150 Z"/><path class="timeline-line timeline-line-a" d="${pathA}"/>${pathB ? `<path class="timeline-line timeline-line-b" d="${pathB}"/>` : ""}<line id="timelineCursor" class="timeline-cursor" x1="${xAt(rows.length-1)}" y1="18" x2="${xAt(rows.length-1)}" y2="154"/><circle id="timelinePointA" class="timeline-point timeline-point-a" cx="${xAt(rows.length-1)}" cy="${yAt(rows[rows.length-1].a ?? min)}" r="5"/>${compare ? `<circle id="timelinePointB" class="timeline-point timeline-point-b" cx="${xAt(rows.length-1)}" cy="${yAt(rows[rows.length-1].b ?? min)}" r="5"/>` : ""}`;
  svg.dataset.compare = String(compare);
  svg.dataset.min = String(min);
  svg.dataset.max = String(max);
  svg.dataset.rowCount = String(rows.length);
  slider.oninput = () => updateTimelineSelection(Number(slider.value));
  updateTimelineSelection(rows.length - 1, { xAt, yAt });
}

function updateTimelineSelection(index, geometry = null) {
  const rows = state.timelineRows;
  if (!rows.length) return;
  const safeIndex = Math.max(0, Math.min(rows.length - 1, index));
  const row = rows[safeIndex];
  const slider = $("#reportTimelineSlider");
  if (slider && Number(slider.value) !== safeIndex) slider.value = String(safeIndex);
  const pointDate = new Date(`${row.date.slice(0, 7)}-01T00:00:00`);
  $("#timelineSelectedDate").textContent = pointDate.toLocaleDateString(undefined, { year: "numeric", month: "long" });
  $("#timelineSelectedIndex").textContent = `OBSERVATION ${String(safeIndex + 1).padStart(3, "0")} / ${rows.length}`;
  const unit = state.activeResult?.variable?.unit || "";
  const prior = safeIndex > 0 ? rows[safeIndex - 1] : null;
  const card = (label, name, value, anomaly, previous, kind) => {
    if (!Number.isFinite(value)) return `<div class="timeline-value-card ${kind}"><span>${label}</span><strong>—</strong><small>No observation returned for this month.</small></div>`;
    const delta = Number.isFinite(previous) ? value - previous : null;
    return `<div class="timeline-value-card ${kind}"><span>${label} · ${esc(name)}</span><strong>${numberFormat(value, 4)} <small>${esc(unit)}</small></strong><small>${Number.isFinite(anomaly) ? `ANOMALY ${numberFormat(anomaly, 4)} ${esc(unit)} · ` : ""}${delta === null ? "No earlier adjacent observation" : `CHANGE FROM PREVIOUS STEP ${numberFormat(delta, 4)} ${esc(unit)}`}</small></div>`;
  };
  if (state.activeComparison) {
    const aName = state.activeComparison.region_a.region.name;
    const bName = state.activeComparison.region_b.region.name;
    $("#timelineReadouts").innerHTML = card("POINT A", aName, row.a, row.anomalyA, prior?.a, "point-a") + card("POINT B", bName, row.b, row.anomalyB, prior?.b, "point-b");
  } else {
    $("#timelineReadouts").innerHTML = card("NASA POWER VALUE", state.activeResult.region.name, row.a, row.anomalyA, prior?.a, "point-a");
  }
  const svg = $("#reportTimelineSvg");
  if (svg) {
    const min = Number(svg.dataset.min ?? 0);
    const max = Number(svg.dataset.max ?? 1);
    const xAt = (idx) => 34 + (rows.length === 1 ? 0 : idx / (rows.length - 1)) * 932;
    const yAt = (value) => 150 - ((value - min) / Math.max(1e-12, max - min)) * 112;
    const x = xAt(safeIndex);
    const cursor = $("#timelineCursor", svg);
    cursor?.setAttribute("x1", x.toFixed(2));
    cursor?.setAttribute("x2", x.toFixed(2));
    const pointA = $("#timelinePointA", svg);
    if (pointA && Number.isFinite(row.a)) { pointA.setAttribute("cx", x.toFixed(2)); pointA.setAttribute("cy", yAt(row.a).toFixed(2)); pointA.style.display = ""; }
    else if (pointA) pointA.style.display = "none";
    const pointB = $("#timelinePointB", svg);
    if (pointB && Number.isFinite(row.b)) { pointB.setAttribute("cx", x.toFixed(2)); pointB.setAttribute("cy", yAt(row.b).toFixed(2)); pointB.style.display = ""; }
    else if (pointB) pointB.style.display = "none";
  }
}

function renderSeriesPanel(result) {
  const isComparison = !!state.activeComparison;
  const mode = isComparison ? "comparison" : "single";
  return `
    <div class="panel-kicker">${mode === "comparison" ? "REGION A / REGION B" : "NASA POWER / MONTHLY SERIES"}</div>
    <div class="chart-legend"><span><i class="legend-dot" style="background:#69c9d0"></i>${isComparison ? esc(state.activeComparison.region_a.region.name) : "Monthly anomaly"}</span><span><i class="legend-dot" style="background:#f2a45b"></i>${isComparison ? esc(state.activeComparison.region_b.region.name) : "OLS-HAC fit"}</span></div>
    <div class="chart-wrap"><canvas id="seriesChart" aria-label="Monthly time series chart"></canvas></div>
    ${isComparison ? `<div class="interpretation">${esc(state.activeComparison.slope_difference_test.description)} Direct test p-value: ${numberFormat(state.activeComparison.slope_difference_test.p_value, 4)}.</div>` : `<p class="chart-note">The chart shows monthly anomalies relative to the selected period's calendar-month means. Switch to original values via the control below. Missing months are not interpolated.</p><button class="small-action" data-action="raw-chart">Show original monthly values</button>`}
    <div class="panel-action-row"><button class="small-action" data-action="export-csv">Export CSV ↓</button><button class="small-action" data-action="export-json">Export evidence JSON ↓</button></div>`;
}

function renderStatistics(result) {
  const t = result.trend;
  const m = result.mann_kendall;
  const s = result.theil_sen;
  return `
    <span class="result-badge ${["significant_increasing_trend", "significant_decreasing_trend"].includes(t.classification) ? "" : "warning"}">${esc(classificationLabel(t.classification))}</span>
    <div class="method-block"><h4>01 / OLS WITH HAC UNCERTAINTY</h4><div class="statistics-list">
      <div class="stat-row"><span>Slope / year</span><strong>${numberFormat(t.slope_per_year, 6)} ${esc(result.variable.unit)}</strong></div>
      <div class="stat-row"><span>Slope / decade</span><strong>${numberFormat(t.slope_per_decade, 5)} ${esc(result.variable.unit)}</strong></div>
      <div class="stat-row"><span>95% confidence interval</span><strong>[${numberFormat(t.confidence_interval_95[0], 5)}, ${numberFormat(t.confidence_interval_95[1], 5)}]</strong></div>
      <div class="stat-row"><span>p-value / α</span><strong>${numberFormat(t.p_value, 5)} / ${numberFormat(t.significance_level, 2)}</strong></div>
      <div class="stat-row"><span>HAC lag window</span><strong>${t.hac_lags} months</strong></div>
      <div class="stat-row"><span>HAC time basis</span><strong>${esc(t.hac_time_basis || "monthly observations")}</strong></div>
      <div class="stat-row"><span>Residual lag-1 correlation</span><strong>${numberFormat(t.residual_lag1_autocorrelation, 3)}</strong></div>
    </div></div>
    <div class="method-block"><h4>02 / SEASONAL MANN–KENDALL</h4><div class="statistics-list">
      <div class="stat-row"><span>Kendall's τ</span><strong>${numberFormat(m.tau, 4)}</strong></div>
      <div class="stat-row"><span>p-value</span><strong>${numberFormat(m.p_value, 5)}</strong></div>
      <div class="stat-row"><span>Method</span><strong>Calendar-month strata</strong></div>
    </div></div>
    <div class="method-block"><h4>03 / THEIL–SEN ROBUST SLOPE</h4><div class="statistics-list">
      <div class="stat-row"><span>Slope / year</span><strong>${numberFormat(s.slope_per_year, 5)}</strong></div>
      <div class="stat-row"><span>95% slope interval</span><strong>${s.confidence_interval_95 ? `[${numberFormat(s.confidence_interval_95[0], 5)}, ${numberFormat(s.confidence_interval_95[1], 5)}]` : "—"}</strong></div>
    </div></div>
    <div class="chart-note">A p-value is not a measure of effect size or practical importance. A non-significant result does not prove that no change exists.</div>
    <div class="panel-action-row"><button class="small-action" data-action="extend">Try a longer period ↗</button><button class="small-action" data-action="export-json">Export statistics ↓</button></div>`;
}

function renderEvidence(result) {
  const q = result.quality;
  const notes = result.method_notes.map((item) => `<li>${esc(item)}</li>`).join("");
  const limits = q.quality_limitations.map((item) => `<li>${esc(item)}</li>`).join("");
  return `
    <div class="method-block"><h4>DATASET & PROVENANCE</h4><p><strong>${esc(result.dataset.title)}</strong><br />Provider: NASA · ${esc(result.dataset.source_family)}<br />Variable: ${esc(result.variable.id)} · ${esc(result.variable.unit)}<br />Collection/API version: ${esc(result.dataset.collection_version)}</p><a class="evidence-link" href="${esc(result.dataset.source_url)}" target="_blank" rel="noopener">NASA POWER documentation ↗</a></div>
    <div class="method-block"><h4>REQUEST & RETRIEVAL</h4><p>Point: ${numberFormat(result.region.latitude, 4)}°, ${numberFormat(result.region.longitude, 4)}°<br />Requested: ${esc(result.period.requested_start)} to ${esc(result.period.requested_end)}<br />Actual: ${esc(result.period.actual_first_observation)} to ${esc(result.period.actual_last_observation)}<br />Frequency: monthly<br />NASA response retrieved at: ${esc(result.dataset.retrieved_at || result.created_at)}<br />Cache state: ${esc(result.dataset.cache_status || "not reported")}</p><a class="evidence-link" href="${esc(result.dataset.request_url)}" target="_blank" rel="noopener">Open source request ↗</a></div>
    <div class="method-block"><h4>QUALITY & COVERAGE</h4><p>${q.valid_observations} valid of ${q.expected_observations} expected monthly values (${numberFormat(q.temporal_coverage_percent, 2)}%). Quality state: ${esc(q.quality_classification)}.</p><ul>${limits}</ul></div>
    <div class="method-block"><h4>ANALYSIS OPERATIONS</h4><ul>${notes}</ul></div>
    <div class="method-block"><h4>INTERPRETATION SAFEGUARD</h4><p>EarthTrace reports an estimated pattern in the selected data. It does not establish the physical cause, provide a forecast, or substitute a regional area mean for this point estimate.</p></div>
    <div class="panel-action-row"><button class="small-action" data-action="export-json">Download evidence JSON ↓</button><button class="small-action" data-action="export-csv">Download series CSV ↓</button></div>`;
}

function attachAnalysisActions() {
  $$('[data-action]', $("#analysisContent")).forEach((button) => button.addEventListener("click", () => {
    const action = button.dataset.action;
    if (action === "series") setActiveTab("series");
    else if (action === "compare") startComparisonSelection();
    else if (action === "extend") extendCurrentAnalysis();
    else if (action === "refresh") refreshCurrentAnalysis();
    else if (action === "export-csv") downloadResult("csv");
    else if (action === "export-json") downloadResult("json");
    else if (action === "compare-chart") setActiveTab("series");
    else if (action === "raw-chart") renderSeriesChart(state.activeResult, true);
  }));
}

function downloadResult(format) {
  if (!state.activeResult) return;
  window.open(`/api/analysis/results/${state.activeResult.result_id}/export.${format}`, "_blank", "noopener");
}

function renderSeriesChart(result, raw = false) {
  const canvas = $("#seriesChart");
  if (!canvas || !window.Chart) return;
  if (state.chart) state.chart.destroy();
  const comparison = state.activeComparison;
  const labels = result.series.map((item) => item.date.slice(0, 7));
  const anomalyValues = result.series.map((item) => item.anomaly);
  const values = result.series.map((item) => item.value);
  const datasets = [];
  if (comparison) {
    const a = comparison.region_a;
    const b = comparison.region_b;
    const alignedLabels = [...new Set([...a.series, ...b.series].map((item) => item.date.slice(0, 7)))].sort();
    const aMap = new Map(a.series.map((item) => [item.date.slice(0, 7), item.anomaly]));
    const bMap = new Map(b.series.map((item) => [item.date.slice(0, 7), item.anomaly]));
    datasets.push({ label: a.region.name, data: alignedLabels.map((stamp) => aMap.has(stamp) ? aMap.get(stamp) : null), borderColor: "#69c9d0", pointRadius: 0, borderWidth: 1.7, tension: 0.12, spanGaps: false });
    datasets.push({ label: b.region.name, data: alignedLabels.map((stamp) => bMap.has(stamp) ? bMap.get(stamp) : null), borderColor: "#f2a45b", pointRadius: 0, borderWidth: 1.7, tension: 0.12, spanGaps: false });
    state.chart = createLineChart(canvas, alignedLabels, datasets, `Monthly anomaly (${a.variable.unit})`);
    return;
  }
  datasets.push({ label: raw ? "Original monthly value" : "Monthly anomaly", data: raw ? values : anomalyValues, borderColor: "#69c9d0", backgroundColor: "rgba(105,201,208,.08)", pointRadius: 0, borderWidth: 1.7, fill: true, tension: 0.15 });
  if (!raw && result.trend.fitted_values) datasets.push({ label: "OLS-HAC fitted trend", data: result.trend.fitted_values, borderColor: "#f2a45b", pointRadius: 0, borderWidth: 1.3, borderDash: [5, 5], tension: 0 });
  state.chart = createLineChart(canvas, labels, datasets, raw ? `${result.variable.unit} · original values` : `${result.variable.unit} · anomaly`);
}

function createLineChart(canvas, labels, datasets, yTitle) {
  return new Chart(canvas, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 550 },
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: false }, tooltip: { backgroundColor: "#0d1a2a", borderColor: "rgba(150,177,202,.2)", borderWidth: 1, titleFont: { family: "DM Mono", size: 9 }, bodyFont: { family: "Manrope", size: 9 }, displayColors: true } },
      scales: {
        x: { grid: { color: "rgba(150,177,202,.07)" }, ticks: { color: "#718599", maxTicksLimit: 7, font: { family: "DM Mono", size: 8 } }, border: { display: false } },
        y: { title: { display: true, text: yTitle, color: "#8092a4", font: { family: "DM Mono", size: 8 } }, grid: { color: "rgba(150,177,202,.07)" }, ticks: { color: "#718599", font: { family: "DM Mono", size: 8 } }, border: { display: false } },
      },
    },
  });
}

function startComparisonSelection() {
  state.comparisonMode = true;
  toast("Select a second point on the globe. The dataset, variable, dates and method will stay the same.", "info", 5500);
  $("#mapHint").innerHTML = "<span>✣</span> SELECT A SECOND POINT TO COMPARE";
  $("#analysisRegionTitle").textContent = "Choose comparison point";
}

async function runComparison(regionB, requestOverride = null) {
  if (!state.activeResult || !state.lastAnalysisRequest) return;
  setAnalysisPanelVisible(true);
  const regionA = {
    type: "Point",
    lat: state.activeResult.region.latitude,
    lon: state.activeResult.region.longitude,
    name: state.activeResult.region.name,
  };
  const request = { ...(requestOverride || state.lastAnalysisRequest), region: regionA };
  toast("Retrieving the second point using the same settings…");
  try {
    const comparison = await apiRequest("/api/analysis/compare", { method: "POST", body: JSON.stringify({ settings: request, region_b: regionB }) });
    state.activeComparison = comparison;
    state.activeResult = comparison.region_a;
    state.lastAnalysisRequest = { ...request, force_refresh: false };
    state.isSavedResult = false;
    state.refreshFailed = false;
    addComparisonMarkers(comparison.region_a.region, comparison.region_b.region);
    setActiveTab("overview");
    $("#analysisRegionTitle").textContent = "Regional comparison";
    $("#analysisVariableSubtitle").textContent = `${comparison.region_a.variable.name} · matched settings`;
    renderAnalysis();
    setAnalysisPanelVisible(true);
    toast("Both regional series are ready; the slope difference was tested directly.", "success");
    $("#mapHint").innerHTML = "<span>✣</span> TWO POINTS / COMPARISON READY";
  } catch (error) {
    if (request.force_refresh && state.activeComparison) {
      state.refreshFailed = true;
      $("#sourceState").className = "source-state saved";
      $("#sourceState").innerHTML = "<i></i> PREVIOUS COMPARISON · NOT REFRESHED";
      renderAnalysis();
      toast(`NASA refresh failed. The previous comparison is still shown. ${error.message}`, "error", 8500);
    } else {
      toast(`Comparison failed: ${error.message}`, "error", 7000);
    }
    $("#mapHint").innerHTML = "<span>✣</span> DRAG TO ROTATE · CLICK TO SELECT";
  }
}


async function refreshCurrentAnalysis() {
  if (!state.lastAnalysisRequest) {
    toast("Open a live or saved analysis before refreshing its source data.");
    return;
  }
  const request = { ...state.lastAnalysisRequest, force_refresh: true };
  if (state.activeComparison) {
    const regionB = {
      type: "Point",
      lat: state.activeComparison.region_b.region.latitude,
      lon: state.activeComparison.region_b.region.longitude,
      name: state.activeComparison.region_b.region.name,
    };
    await runComparison(regionB, request);
    return;
  }
  await runAnalysis(null, request);
}

async function extendCurrentAnalysis() {
  if (!state.activeResult) return;
  const latestPublishedYear = new Date().getUTCFullYear() - 1;
  if (!window.confirm(`Re-run this same point, variable and method over the extended NASA POWER record (1981–${latestPublishedYear})? The original analysis will be preserved.`)) return;
  try {
    toast("Checking the longer published record…");
    const extended = await apiRequest("/api/analysis/extend", { method: "POST", body: JSON.stringify({ result_id: state.activeResult.result_id, start_year: 1981, end_year: latestPublishedYear }) });
    const current = extended.extended;
    state.activeResult = current;
    state.activeComparison = null;
    state.isSavedResult = false;
    state.refreshFailed = false;
    $("#analysisRegionTitle").textContent = current.region.name;
    $("#analysisVariableSubtitle").textContent = `${current.variable.name} · extended period`;
    setActiveTab("overview");
    toast(extended.comparison.note, "success", 6500);
  } catch (error) {
    toast(`Longer-period request failed: ${error.message}`, "error", 7000);
  }
}

// The report is a full-width workspace below the globe and appears only after analysis.
function setAnalysisPanelVisible(visible, scrollToReport = false) {
  const report = $("#analysisPanel");
  if (!report) return;
  report.hidden = !visible;
  $("#showAnalysis").hidden = Boolean(visible) || !state.activeResult;
  window.setTimeout(() => {
    resizeGlobe();
    if (visible && scrollToReport) report.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 180);
}
$("#collapseAnalysis")?.addEventListener("click", () => {
  setAnalysisPanelVisible(false);
  $("#earthStage")?.scrollIntoView({ behavior: "smooth", block: "center" });
});
$("#showAnalysis")?.addEventListener("click", () => setAnalysisPanelVisible(true, true));

// ---------------------------------------------------------------------------
// SAVED INVESTIGATIONS
// ---------------------------------------------------------------------------
$("#saveInvestigation")?.addEventListener("click", async () => {
  if (!state.activeResult) {
    toast("Complete an analysis before saving an investigation.");
    return;
  }
  const title = `${state.activeResult.variable.name} · ${state.activeResult.region.name}`;
  try {
    const saved = await apiRequest("/api/investigations", {
      method: "POST",
      body: JSON.stringify({ title, payload: { result_id: state.activeResult.result_id, result: state.activeResult, comparison: state.activeComparison } }),
    });
    toast(`Investigation saved locally: ${saved.title}`, "success");
  } catch (error) { toast(`Could not save: ${error.message}`, "error"); }
});

// Saved investigations: the database stores the exact output and its evidence.
$("#viewSavedInvestigations")?.addEventListener("click", openSavedInvestigations);
async function openSavedInvestigations() {
  const list = $("#savedInvestigationList");
  list.innerHTML = `<p class="chart-note">Loading saved investigations…</p>`;
  showModal("savedModal");
  try {
    const data = await apiRequest("/api/investigations");
    if (!data.investigations?.length) {
      list.innerHTML = `<div class="empty-analysis"><div class="empty-orbit">◎</div><h4>No saved investigations yet.</h4><p>Run an analysis in Earth Explorer, then choose Save investigation.</p></div>`;
      return;
    }
    list.innerHTML = data.investigations.map((item) => `<div class="saved-study-row"><div><h4>${esc(item.title)}</h4><p>${esc(new Date(item.created_at).toLocaleString())}</p></div><button class="small-action" data-open-saved="${esc(item.investigation_id)}">Open evidence ↗</button></div>`).join("");
    $$('[data-open-saved]').forEach((button) => button.addEventListener("click", () => loadSavedInvestigation(button.dataset.openSaved)));
  } catch (error) {
    list.innerHTML = `<div class="interpretation">Saved investigations could not be loaded: ${esc(error.message)}</div>`;
  }
}
async function loadSavedInvestigation(id) {
  try {
    const saved = await apiRequest(`/api/investigations/${id}`);
    const payload = saved.payload || {};
    if (!payload.result) throw new Error("This saved record does not contain a complete analysis result.");
    state.activeResult = { ...payload.result, source_state: "saved_result" };
    state.activeComparison = payload.comparison || null;
    state.isSavedResult = true;
    state.refreshFailed = false;
    state.lastAnalysisRequest = {
      dataset_id: state.activeResult.dataset.id,
      variable_id: state.activeResult.variable.id,
      region: {
        type: "Point",
        lat: state.activeResult.region.latitude,
        lon: state.activeResult.region.longitude,
        name: state.activeResult.region.name,
      },
      start_date: state.activeResult.period.requested_start,
      end_date: state.activeResult.period.requested_end,
      temporal_frequency: "monthly",
      seasonality: state.activeResult.trend.series_used === "original monthly value" ? "original_values" : "monthly_anomalies",
      significance_level: state.activeResult.trend.significance_level || 0.05,
      force_refresh: false,
    };
    state.selectedVariable = state.activeResult.variable.id;
    $("#variableSelect").value = state.selectedVariable;
    updateVariableContext();
    state.selectedRegion = { type: "Point", lat: state.activeResult.region.latitude, lon: state.activeResult.region.longitude, name: state.activeResult.region.name };
    $("#selectedLocationName").textContent = state.selectedRegion.name;
    $("#selectedCoordinates").textContent = `${state.selectedRegion.lat.toFixed(4)}°, ${state.selectedRegion.lon.toFixed(4)}°`;
    $("#startYear").value = Number(state.activeResult.period.requested_start.slice(0, 4));
    $("#endYear").value = Number(state.activeResult.period.requested_end.slice(0, 4));
    $("#analysisRegionTitle").textContent = state.activeComparison ? "Saved regional comparison" : state.activeResult.region.name;
    $("#analysisVariableSubtitle").textContent = `${state.activeResult.variable.name} · saved evidence`;
    $("#sourceState").className = "source-state saved";
    $("#sourceState").innerHTML = "<i></i> SAVED RESULT · NOT REFRESHED";
    $("#analysisDateStamp").textContent = new Date(state.activeResult.created_at).toLocaleDateString();
    addSelectionMarker(state.selectedRegion);
    closeModal("savedModal");
    openExplorer();
    setActiveTab("overview");
    renderAnalysis();
    setAnalysisPanelVisible(true, true);
    toast("Opened the saved evidence record. It has not been refreshed from NASA.", "success");
  } catch (error) { toast(`Could not open saved investigation: ${error.message}`, "error"); }
}

// ---------------------------------------------------------------------------
// INVESTIGATION GUIDE — three steps, recommendations from the backend catalogue.
// ---------------------------------------------------------------------------
function openGuide() {
  state.guide = { step: 0, answers: {}, selected: null };
  $$("[data-guide-step]").forEach((node) => { node.hidden = Number(node.dataset.guideStep) !== 0; });
  $("#guideResults").hidden = true;
  $("#guideStepLabel").textContent = "01 OF 03";
  $("#guideProgressBar").style.width = "33.33%";
  $("#guideBack").disabled = true;
  $("#guideNext").disabled = true;
  $("#guideNext").innerHTML = "Continue <b>→</b>";
  $("#guideActionHint").textContent = "SELECT ONE ANSWER TO CONTINUE";
  $$(".choice-card, .choice-row").forEach((node) => node.classList.remove("selected"));
  showModal("guideModal");
}
$("#guideButton")?.addEventListener("click", openGuide);
$("#openGuideFromHero")?.addEventListener("click", openGuide);
$("#openGuideCard")?.addEventListener("click", openGuide);
$$("[data-answer]").forEach((button) => button.addEventListener("click", () => {
  const key = button.dataset.answer;
  const value = button.dataset.value;
  state.guide.answers[key] = value;
  state.guide.selected = value;
  const siblings = $$(`[data-answer="${key}"]`);
  siblings.forEach((node) => node.classList.toggle("selected", node === button));
  $("#guideNext").disabled = false;
  $("#guideActionHint").textContent = key === "question" ? "READY TO MATCH THE CATALOGUE" : "ANSWER SELECTED";
}));

$("#guideBack")?.addEventListener("click", () => {
  if (state.guide.step <= 0) return;
  state.guide.step -= 1;
  $("#guideResults").hidden = true;
  showGuideStep(state.guide.step);
});
$("#guideNext")?.addEventListener("click", async () => {
  if (state.guide.step < 2) {
    state.guide.step += 1;
    showGuideStep(state.guide.step);
    return;
  }
  await requestGuideRecommendations();
});
function showGuideStep(step) {
  $$("[data-guide-step]").forEach((node) => { node.hidden = Number(node.dataset.guideStep) !== step; });
  $("#guideStepLabel").textContent = `${String(step + 1).padStart(2, "0")} OF 03`;
  $("#guideProgressBar").style.width = `${((step + 1) / 3) * 100}%`;
  $("#guideBack").disabled = step === 0;
  $("#guideNext").disabled = !state.guide.answers[step === 0 ? "theme" : step === 1 ? "place" : "question"];
  $("#guideNext").innerHTML = step === 2 ? "Find my variables <b>↗</b>" : "Continue <b>→</b>";
  $("#guideActionHint").textContent = "SELECT ONE ANSWER TO CONTINUE";
}
async function requestGuideRecommendations() {
  $("#guideNext").disabled = true;
  $("#guideNext").textContent = "Matching…";
  try {
    const data = await apiRequest("/api/guide/recommendations", { method: "POST", body: JSON.stringify(state.guide.answers) });
    $$("[data-guide-step]").forEach((node) => { node.hidden = true; });
    $("#guideResults").hidden = false;
    $("#guideStepLabel").textContent = "MATCHED";
    $("#guideProgressBar").style.width = "100%";
    $("#guideResultsIntro").textContent = data.note;
    $("#guideRecommendationList").innerHTML = data.recommendations.map((item) => `
      <div class="recommendation"><div><h4>${esc(item.name)} <span style="color:var(--amber);font:9px var(--mono)">${esc(item.unit)}</span></h4><p>${esc(item.why)}</p></div><button class="small-action" data-pick-variable="${esc(item.variable_id)}">Explore this ↗</button></div>`).join("");
    $("#guideNext").disabled = true;
    $("#guideNext").textContent = "Matched to catalogue";
    $("#guideActionHint").textContent = "RECOMMENDATIONS ARE NOT FINDINGS";
    $$('[data-pick-variable]').forEach((button) => button.addEventListener("click", () => {
      state.selectedVariable = button.dataset.pickVariable;
      $("#variableSelect").value = state.selectedVariable;
      updateVariableContext();
      closeModal("guideModal");
      openExplorer();
      toast(`${state.variables.get(state.selectedVariable)?.name} selected. Choose a point and run the analysis.`);
    }));
  } catch (error) {
    toast(`Catalogue matching failed: ${error.message}`, "error");
    $("#guideNext").disabled = false;
    $("#guideNext").textContent = "Retry matching";
  }
}

// ---------------------------------------------------------------------------
// VARIABLE LEARNING CARDS + GLOSSARY
// ---------------------------------------------------------------------------
function showLearningCard(variableId) {
  const variable = state.variables.get(variableId);
  if (!variable) return;
  const technical = variable.technical || variable.method || "Product metadata is returned with the live analysis.";
  const html = `
    <div class="learning-detail-top"><div><span class="learning-code">${esc(variable.id)} / NASA POWER</span><h2 id="learningTitle">${esc(variable.name)}</h2><p class="learning-lead">${esc(variable.simple || "A supported Earth-system variable.")}</p></div><span class="learning-unit">UNIT / ${esc(variable.unit)}</span></div>
    <div class="learning-detail-grid">
      <div class="learning-detail-block"><h4>WHY IT MATTERS</h4><p>${esc(variable.why || "It contributes to understanding an Earth-system process.")}</p></div>
      <div class="learning-detail-block"><h4>HOW IT IS PRODUCED</h4><p>${esc(variable.method || "NASA POWER data service.")}</p></div>
      <div class="learning-detail-block"><h4>WHAT AN INCREASE MAY MEAN</h4><p>${esc(variable.increase || "Interpret direction within the variable's definition and context.")}</p></div>
      <div class="learning-detail-block"><h4>TECHNICAL DETAILS</h4><p>${esc(technical)}</p></div>
    </div>
    <div class="learning-caveat"><strong>Important limitation:</strong> ${esc(variable.caveat || "Check the product definition, units and spatial representation before interpretation.")}<br /><a class="evidence-link" href="https://power.larc.nasa.gov/docs/services/api/temporal/monthly/" target="_blank" rel="noopener">NASA POWER monthly documentation ↗</a></div>
    <div class="panel-action-row"><button class="button button-primary" id="useLearningVariable">Use this variable <b>↗</b></button></div>`;
  $("#learningContent").innerHTML = html;
  $("#useLearningVariable").addEventListener("click", () => {
    state.selectedVariable = variable.id;
    $("#variableSelect").value = variable.id;
    updateVariableContext();
    closeModal("learningModal");
    openExplorer();
  });
  showModal("learningModal");
}
$("#openLearningLibrary")?.addEventListener("click", () => {
  const variable = state.variables.get(state.selectedVariable) || state.catalogue[0];
  if (variable) showLearningCard(variable.id);
});

// ---------------------------------------------------------------------------
// AI DISCOVERY LAB — source-backed OpenAlex records; rules fallback is explicit.
// ---------------------------------------------------------------------------
$("#openDiscoveryLab")?.addEventListener("click", () => showModal("discoveryModal"));
$("#runDiscovery")?.addEventListener("click", async () => {
  const theme = $("#discoveryTheme").value;
  const regionContext = $("#discoveryRegion").value.trim() || (state.selectedRegion?.name ?? "any region");
  const button = $("#runDiscovery");
  button.disabled = true;
  button.textContent = "Searching literature…";
  $("#discoveryResults").innerHTML = `<div class="discovery-mode">RETRIEVING RESEARCH METADATA & MATCHING SUPPORTED VARIABLES…</div>`;
  try {
    const data = await apiRequest("/api/discovery/opportunities", { method: "POST", body: JSON.stringify({ theme, region_context: regionContext, region: state.selectedRegion }) });
    state.discoverySuggestions = data.ideas || [];
    state.discoveryMode = data.mode;
    const papers = (data.evidence_records || []).map((paper) => `
      <div class="research-record"><a href="${esc(paper.url)}" target="_blank" rel="noopener">${esc(paper.title)}</a> · ${esc(paper.year || "Year not listed")} · ${esc((paper.authors || []).join(", "))}</div>`).join("");
    const aiSummary = data.ai_summary ? `<div class="method-block"><h4>AI-ASSISTED RESEARCH SYNTHESIS</h4><p>${esc(data.ai_summary).replace(/\n/g, "<br />")}</p><p class="chart-note">Generated from the returned catalogue and OpenAlex records. Check the source records below before relying on any statement.</p></div>` : "";
    $("#discoveryResults").innerHTML = `
      <div class="discovery-mode">${esc(data.label)} · ${esc(data.literature_state || "")}</div>
      ${data.ideas.map((idea) => `<article class="discovery-idea"><span class="result-badge warning">${esc(idea.status)}</span><h4>${esc(idea.question)}</h4><p>${esc(idea.why_interesting)}</p><div class="research-record">Candidate: ${esc(idea.candidate_variable)} · ${esc(idea.unit)} · ${esc(idea.dataset)}<br />${esc(idea.coverage)}</div><button class="small-action" data-investigate-variable="${esc(idea.candidate_variable)}">Investigate this question ↗</button></article>`).join("")}
      ${aiSummary}
      <div class="method-block"><h4>RETRIEVED RESEARCH RECORDS</h4>${papers || "<p>No OpenAlex records were returned for this query. Suggestions above remain catalogue-matched research ideas, not literature findings.</p>"}</div>
      <p class="chart-note">${esc(data.safeguard)}</p>`;
    $$('[data-investigate-variable]').forEach((node) => node.addEventListener("click", () => {
      state.selectedVariable = node.dataset.investigateVariable;
      $("#variableSelect").value = state.selectedVariable;
      updateVariableContext();
      closeModal("discoveryModal");
      openExplorer();
      toast("Question selected. Choose the exact point and time interval before testing it.");
    }));
  } catch (error) {
    $("#discoveryResults").innerHTML = `<div class="interpretation">Discovery could not complete: ${esc(error.message)}. No unsupported paper or finding has been substituted.</div>`;
  } finally {
    button.disabled = false;
    button.innerHTML = "Discover research ideas <b>↗</b>";
  }
});

// ---------------------------------------------------------------------------
// GUIDED INVESTIGATION THEATRE — step-by-step live run templates.
// ---------------------------------------------------------------------------
let theatreTimer = null;
function openTheatre(study) {
  state.currentStudy = study;
  state.studyStep = 0;
  state.studyPlaying = false;
  $("#theatreTitle").innerHTML = `${esc(study.title)} <em>.</em>`;
  $("#theatreStudyNumber").textContent = study.id === "aswan-temp" ? "01" : "02";
  $("#theatrePlay").textContent = "▶";
  renderTheatreStep();
  showModal("theatreModal");
}

async function startGuidedStudy(studyId) {
  try {
    const study = await apiRequest(`/api/guided-investigations/${studyId}`);
    openTheatre(study);
  } catch (error) { toast(`Could not load guided investigation: ${error.message}`, "error"); }
}
$$(".study-launch").forEach((button) => button.addEventListener("click", () => startGuidedStudy(button.dataset.study)));

function renderTheatreStep() {
  const study = state.currentStudy;
  if (!study) return;
  const step = study.steps[state.studyStep];
  $("#theatreNarration").textContent = step.body;
  $("#theatreStepCount").textContent = `${String(state.studyStep + 1).padStart(2, "0")} / ${String(study.steps.length).padStart(2, "0")}`;
  $("#theatreStepList").innerHTML = study.steps.map((item, index) => `<div class="theatre-step ${index === state.studyStep ? "active" : ""}" data-theatre-step="${index}"><b>${String(index + 1).padStart(2, "0")}</b><span>${esc(item.title)}</span></div>`).join("");
  $$('[data-theatre-step]').forEach((node) => node.addEventListener("click", () => {
    state.studyStep = Number(node.dataset.theatreStep);
    renderTheatreStep();
  }));
  $("#theatrePrev").disabled = state.studyStep === 0;
  $("#theatreNext").disabled = state.studyStep === study.steps.length - 1;
}
function stopTheatrePlayback() {
  state.studyPlaying = false;
  if (theatreTimer) window.clearInterval(theatreTimer);
  theatreTimer = null;
  $("#theatrePlay").textContent = "▶";
}
$("#theatrePrev")?.addEventListener("click", () => { stopTheatrePlayback(); state.studyStep = Math.max(0, state.studyStep - 1); renderTheatreStep(); });
$("#theatreNext")?.addEventListener("click", () => { stopTheatrePlayback(); state.studyStep = Math.min(state.currentStudy.steps.length - 1, state.studyStep + 1); renderTheatreStep(); });
$("#theatrePlay")?.addEventListener("click", () => {
  if (!state.currentStudy) return;
  if (state.studyPlaying) { stopTheatrePlayback(); return; }
  if (state.studyStep >= state.currentStudy.steps.length - 1) state.studyStep = 0;
  state.studyPlaying = true;
  $("#theatrePlay").textContent = "Ⅱ";
  theatreTimer = window.setInterval(() => {
    if (state.studyStep >= state.currentStudy.steps.length - 1) { stopTheatrePlayback(); return; }
    state.studyStep += 1;
    renderTheatreStep();
    $("#theatrePlay").textContent = "Ⅱ";
  }, 4200);
});
$("#theatreRestart")?.addEventListener("click", () => { stopTheatrePlayback(); state.studyStep = 0; renderTheatreStep(); });
$("#theatreTakeOver")?.addEventListener("click", () => {
  stopTheatrePlayback();
  const study = state.currentStudy;
  if (!study) return;
  state.selectedVariable = study.variable_id;
  $("#variableSelect").value = study.variable_id;
  updateVariableContext();
  $("#startYear").value = Number(study.start_date.slice(0, 4));
  $("#endYear").value = Number(study.end_date.slice(0, 4));
  selectRegion(study.region);
  closeModal("theatreModal");
  openExplorer();
  toast("The live study settings are loaded. Run the analysis to retrieve the actual current series.");
});

// ---------------------------------------------------------------------------
// CUAHSI — HydroClient remains a separate station-observation pathway.
// ---------------------------------------------------------------------------
async function checkHydrologyReference() {
  if (!state.selectedRegion) {
    toast("Select a point first to keep the hydrology context geographically relevant.");
    return;
  }
  try {
    const data = await apiRequest("/api/cuahsi/search", { method: "POST", body: JSON.stringify({ region: state.selectedRegion }) });
    toast(data.message, "info", 7000);
  } catch (error) { toast(error.message, "error"); }
}
$("#hydrologyCheckButton")?.addEventListener("click", checkHydrologyReference);


// ---------------------------------------------------------------------------
// INTRODUCTION WORKFLOW — a short, interactive explanation of the method.
// ---------------------------------------------------------------------------
const introSteps = [
  { icon: "?", title: "Start with a question.", body: "Choose a variable such as precipitation, air temperature, humidity or wind. The catalogue explains what it measures and which source pathway is currently supported.", foot: "A question guides the investigation — it does not predetermine the result." },
  { icon: "⌖", title: "Choose where to look.", body: "Open the Earth Explorer, search a listed place or select a point directly on the globe. The selected coordinates are carried into the data request.", foot: "This first release uses NASA POWER point time series, not polygon averages." },
  { icon: "∿", title: "Test the measured series.", body: "Set the time period and run the analysis. EarthTrace retrieves published NASA data, checks missing observations and tests the trend with complementary statistical methods.", foot: "The result reports magnitude, uncertainty, significance and data coverage." },
  { icon: "⇄", title: "Compare and explain.", body: "Compare a second point using the same variable and analysis period. Inspect the direct slope-difference test, then trace the dataset and method in the evidence panel.", foot: "A statistical trend describes a pattern; it does not prove what caused it." },
];
function setIntroStep(index) {
  const safe = (index + introSteps.length) % introSteps.length;
  const step = introSteps[safe];
  $$("[data-intro-step]").forEach((button) => {
    const active = Number(button.dataset.introStep) === safe;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  $("#introVisual").dataset.step = String(safe);
  $("#introVisualIcon").textContent = step.icon;
  $("#introStepCounter").textContent = `STEP ${String(safe + 1).padStart(2, "0")} / 04`;
  $("#introStepTitle").textContent = step.title;
  $("#introStepBody").textContent = step.body;
  $("#introStepFootnote").textContent = step.foot;
  $("#introNextStep").innerHTML = safe === introSteps.length - 1 ? "Back to first step <b>↺</b>" : "Next step <b>→</b>";
}
$$("[data-intro-step]").forEach((button) => button.addEventListener("click", () => setIntroStep(Number(button.dataset.introStep))));
$("#introNextStep")?.addEventListener("click", () => {
  const current = Number($("#introVisual")?.dataset.step || 0);
  setIntroStep(current + 1);
});

// Create a dense but understated orbital particle field once; each point keeps its own
// non-blocking animation so hovering one signal never freezes the rest of the system.
const heroParticleField = $("#heroCelestialParticles");
if (heroParticleField && !heroParticleField.dataset.generated) {
  const particleCount = window.matchMedia?.("(max-width: 600px)").matches ? 30 : 48;
  for (let i = 0; i < particleCount; i += 1) {
    const particle = document.createElement("span");
    const angle = i * 2.399963229728653;
    const radius = 34 + ((i * 17) % 27);
    const x = 50 + Math.cos(angle) * radius * 1.2;
    const y = 50 + Math.sin(angle) * radius * 0.72;
    const size = 1.2 + ((i * 7) % 11) / 10;
    particle.className = `cosmic-particle${i % 9 === 0 ? " tone-amber" : i % 5 === 0 ? " tone-blue" : ""}`;
    particle.style.left = `${Math.max(1, Math.min(99, x)).toFixed(2)}%`;
    particle.style.top = `${Math.max(2, Math.min(98, y)).toFixed(2)}%`;
    particle.style.setProperty("--particle-size", `${size.toFixed(1)}px`);
    particle.style.setProperty("--particle-duration", `${5.8 + (i % 8) * 1.17}s`);
    particle.style.setProperty("--particle-delay", `${-((i * 13) % 23) / 2}s`);
    particle.style.setProperty("--particle-dx", `${((i * 5) % 13) - 6}px`);
    particle.style.setProperty("--particle-dy", `${-4 - ((i * 3) % 9)}px`);
    heroParticleField.appendChild(particle);
  }
  heroParticleField.dataset.generated = "true";
}

// Orbit labels brighten on approach, then return to their resting state on pointerleave.
// Click toggles a deliberate pin; the CSS orbital motion itself is never paused.
const heroVisual = $(".hero-visual");
const orbitNodes = $$('[data-orbit-info]');
const orbitNote = $("#orbitNote");
const defaultOrbitNote = "HOVER OVER A SIGNAL TO EXPLORE ITS SYSTEM";
let pinnedOrbitNode = null;
function renderOrbitState(hoveredNode = null) {
  const shownNode = hoveredNode || pinnedOrbitNode;
  orbitNodes.forEach((item) => item.classList.toggle("active", item === shownNode));
  if (orbitNote) orbitNote.textContent = shownNode?.dataset.orbitInfo || defaultOrbitNote;
  heroVisual?.classList.toggle("is-orbit-engaged", Boolean(shownNode));
}
orbitNodes.forEach((node) => {
  node.addEventListener("pointerenter", () => renderOrbitState(node));
  node.addEventListener("pointerleave", () => {
    if (document.activeElement !== node) renderOrbitState();
  });
  node.addEventListener("focus", () => renderOrbitState(node));
  node.addEventListener("blur", () => renderOrbitState());
  node.addEventListener("click", (event) => {
    pinnedOrbitNode = pinnedOrbitNode === node ? null : node;
    // A pointer click should not leave a stale mouse-focus highlight behind.
    // Keyboard activation keeps focus, which remains a useful accessible state.
    if (event.detail > 0) node.blur();
    renderOrbitState(node.matches(":hover") ? node : null);
  });
});

// A small light follows the pointer only on the discovery and study cards.
// This is intentionally limited to those cards rather than every panel on the page.
const spotlightCards = $$(".feature-card, .study-card");
spotlightCards.forEach((card) => {
  card.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch") return;
    const rect = card.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 100;
    const y = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * 100;
    card.style.setProperty("--spot-x", `${Math.max(0, Math.min(100, x)).toFixed(1)}%`);
    card.style.setProperty("--spot-y", `${Math.max(0, Math.min(100, y)).toFixed(1)}%`);
  });
  card.addEventListener("pointerleave", () => {
    card.style.setProperty("--spot-x", "50%");
    card.style.setProperty("--spot-y", "50%");
  });
});

// The molecular visual responds to hover, keyboard focus and click.
const hydroMolecule = $("#hydroMolecule");
const hydroInsight = $("#hydroInsight");
const hydroMessage = "Water connects rainfall, soil moisture, evaporation and runoff. CUAHSI station records can add independent local context to the NASA signal.";
let hydroPinned = false;
function setHydroActive(active) {
  hydroMolecule?.classList.toggle("is-active", active);
  hydroMolecule?.setAttribute("aria-pressed", hydroPinned ? "true" : "false");
  if (hydroInsight) hydroInsight.textContent = active ? hydroMessage : "HOVER OR CLICK THE MOLECULE TO EXPLORE THE WATER SYSTEM";
}
hydroMolecule?.addEventListener("pointerenter", () => setHydroActive(true));
hydroMolecule?.addEventListener("pointerleave", () => setHydroActive(hydroPinned));
hydroMolecule?.addEventListener("focus", () => setHydroActive(true));
hydroMolecule?.addEventListener("blur", () => setHydroActive(hydroPinned));
hydroMolecule?.addEventListener("click", () => { hydroPinned = !hydroPinned; setHydroActive(hydroPinned); });

// Subtle pointer parallax and scroll reveals; both gracefully fall back without these APIs.
const heroGrid = $("#heroGrid");
heroGrid?.addEventListener("pointermove", (event) => {
  const rect = heroGrid.getBoundingClientRect();
  const x = (event.clientX - rect.left) / Math.max(rect.width, 1) - 0.5;
  const y = (event.clientY - rect.top) / Math.max(rect.height, 1) - 0.5;
  heroGrid.style.setProperty("--pointer-x", `${(x * 18).toFixed(2)}px`);
  heroGrid.style.setProperty("--pointer-y", `${(y * 13).toFixed(2)}px`);
  heroGrid.style.setProperty("--globe-offset-x", `${(-x * 9).toFixed(2)}px`);
  heroGrid.style.setProperty("--globe-offset-y", `${(-y * 7).toFixed(2)}px`);
  heroGrid.style.setProperty("--cosmos-offset-x", `${(x * 5).toFixed(2)}px`);
  heroGrid.style.setProperty("--cosmos-offset-y", `${(y * 4).toFixed(2)}px`);
});
heroGrid?.addEventListener("pointerleave", () => {
  heroGrid.style.setProperty("--pointer-x", "0px");
  heroGrid.style.setProperty("--pointer-y", "0px");
  heroGrid.style.setProperty("--globe-offset-x", "0px");
  heroGrid.style.setProperty("--globe-offset-y", "0px");
  heroGrid.style.setProperty("--cosmos-offset-x", "0px");
  heroGrid.style.setProperty("--cosmos-offset-y", "0px");
});
if ("IntersectionObserver" in window && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
  const revealObserver = new IntersectionObserver((entries) => entries.forEach((entry) => {
    if (entry.isIntersecting) { entry.target.classList.add("is-visible"); revealObserver.unobserve(entry.target); }
  }), { threshold: 0.08 });
  $$(".introduction-section, .discover-section, .explorer-section, .theatre-section, .hydrology-section, .team-section").forEach((section) => {
    section.classList.add("reveal-on-scroll");
    revealObserver.observe(section);
  });
}

// ---------------------------------------------------------------------------
// NAVIGATION, ABOUT, ACCESSIBILITY
// ---------------------------------------------------------------------------
$$(".nav-link").forEach((link) => link.addEventListener("click", (event) => {
  $$(".nav-link").forEach((item) => item.classList.toggle("active", item === link));
  if (link.getAttribute("href") === "#observatory") state.activeView = "home";
  if (link.getAttribute("href") === "#explorer") { event.preventDefault(); openExplorer(); }
}));
$("#aboutButton")?.addEventListener("click", () => {
  toast("EarthTrace is a scientific investigation interface. Its first working data adapter uses NASA POWER monthly MERRA-2-derived point series.", "info", 6500);
});

// Motion preference is applied explicitly for app transitions as well as CSS.
if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) document.documentElement.classList.add("reduced-motion");

// Initialize catalogue and health. No external data request runs until a user starts an analysis.
initializeApplication();
