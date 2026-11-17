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
  isSavedResult: false,
  refreshFailed: false,
  globeReady: false,
  chart: null,
  timelineRows: [],
  scan: { token: 0, running: false, points: [], results: new Map(), variable: null, start: null, end: null, born: new Map() },
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
    const sunlight = new THREE.DirectionalLight(0xeaf4ff, 2.4);
    sunlight.position.set(4, 2.2, 4.5);
    globeScene.add(sunlight);
    const fill = new THREE.DirectionalLight(0x2b759b, 0.38);
    fill.position.set(-4, -1, -3);
    globeScene.add(fill);

    const earthGeometry = new THREE.SphereGeometry(1.45, 96, 96);
    const earthMaterial = new THREE.MeshPhongMaterial({ color: 0x3b7995, shininess: 13, specular: new THREE.Color(0x394c61) });
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
    // Markers and scan bars are children of the Earth, so they stay on the right spot while it turns.
    markerGroup = new THREE.Group();
    earthMesh.add(markerGroup);
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
    canvas.addEventListener("pointermove", onGlobeHover);
    canvas.addEventListener("pointerleave", hideScanTooltip);
    state.globeReady = true;
    $(".small-fallback")?.setAttribute("hidden", "hidden");
    paintScanOnGlobe();
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
  requestAnimationFrame(animateGlobe);
  if (earthMesh && !state.selectedRegion && !state.scan.results.size && !state.scan.running) earthMesh.rotation.y += 0.00022;
  animateScanBars();
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
    new THREE.MeshBasicMaterial({ color: 0x7fe0c4 }),
  );
  core.position.copy(position);
  markerGroup.add(core);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.05, 0.065, 48),
    new THREE.MeshBasicMaterial({ color: 0x59c2d0, transparent: true, opacity: 0.95, side: THREE.DoubleSide }),
  );
  ring.position.copy(position.clone().multiplyScalar(1.012));
  ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), position.clone().normalize());
  markerGroup.add(ring);
  const beam = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([position.clone().multiplyScalar(1.0), position.clone().multiplyScalar(1.2)]),
    new THREE.LineBasicMaterial({ color: 0x7fe0c4, transparent: true, opacity: 0.75 }),
  );
  markerGroup.add(beam);
}

function addComparisonMarkers(regionA, regionB) {
  if (!THREE || !markerGroup) return;
  markerGroup.clear();
  [regionA, regionB].forEach((region, index) => {
    const position = pointToVector(region.latitude, region.longitude, 1.475);
    const color = index === 0 ? 0x59c2d0 : 0xa98bff;
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.034, 18, 18), new THREE.MeshBasicMaterial({ color }));
    core.position.copy(position);
    markerGroup.add(core);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.063, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    ring.position.copy(position.clone().multiplyScalar(1.012));
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), position.clone().normalize());
    markerGroup.add(ring);
  });
}

function focusGlobeOn(region) {
  if (!THREE || !globeCamera || !globeControls) return;
  const surface = pointToVector(region.lat, region.lon, 1);
  const world = earthMesh ? earthMesh.localToWorld(surface.clone()) : surface.clone();
  cameraDestination = world.normalize().multiplyScalar(4.2);
  globeControls.target.set(0, 0, 0);
}

function globeSurfacePoint(event) {
  if (!globeRenderer || !earthMesh || !raycaster) return null;
  const rect = globeRenderer.domElement.getBoundingClientRect();
  pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNdc, globeCamera);
  const intersections = raycaster.intersectObject(earthMesh, false);
  if (!intersections.length) return null;
  const local = earthMesh.worldToLocal(intersections[0].point.clone()).normalize();
  return {
    lat: THREE.MathUtils.radToDeg(Math.asin(local.y)),
    lon: THREE.MathUtils.radToDeg(Math.atan2(-local.z, local.x)),
  };
}

function handleGlobeClick(event) {
  const spot = globeSurfacePoint(event);
  if (!spot) return;
  const scanned = nearestScanResult(spot.lat, spot.lon);
  if (scanned) { openScanPoint(scanned.id); return; }
  const region = { type: "Point", lat: Number(spot.lat.toFixed(4)), lon: Number(spot.lon.toFixed(4)), name: "Selected point" };
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
    syncCompareButton();
    runComparison(state.selectedRegion);
  }
}

// ---------------------------------------------------------------------------
// EXPLORER CONTROLS AND REGION SEARCH
// ---------------------------------------------------------------------------
function openExplorer() { showView("explorer"); }
function openDataDetective() { showView("discover"); }

$("#startExploring")?.addEventListener("click", openExplorer);
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
  clearScan();
});
$("#learnVariable")?.addEventListener("click", () => showLearningCard(state.selectedVariable));
$("#resetGlobe")?.addEventListener("click", () => {
  if (!globeCamera || !globeControls) return;
  cameraDestination = new THREE.Vector3(0, 0, 4.65);
  globeControls.reset();
  toast("Globe view reset.");
});
$("#locateMe")?.addEventListener("click", () => {
  if (!navigator.geolocation) { toast("This browser cannot share a location. Search for a place or click the globe instead.", "error"); return; }
  toast("Asking your device for its location…");
  navigator.geolocation.getCurrentPosition(
    (pos) => selectRegion({ type: "Point", lat: Number(pos.coords.latitude.toFixed(4)), lon: Number(pos.coords.longitude.toFixed(4)), name: "My location" }),
    () => toast("Location permission was not granted. Search for a place or click the globe instead.", "error"),
    { timeout: 8000, maximumAge: 600000 },
  );
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
  setAnalysisPanelVisible(true, true);
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
    if (created.status === "failed") throw new Error(created.error || "The analysis failed.");
    if (created.status === "completed" && created.result) job = { status: "completed", result_id: created.result_id, result: created.result };
    for (let attempt = 0; !job && attempt < 100; attempt += 1) {
      await sleep(1150);
      job = await apiRequest(`/api/analysis/jobs/${created.job_id}`);
      setProgress(job.status, job.message || "");
      if (job.status === "completed" || job.status === "failed") break;
    }
    if (!job || job.status !== "completed") {
      throw new Error(job?.error || "The analysis did not finish. The result was not fabricated.");
    }
    const result = job.result || await apiRequest(`/api/analysis/results/${job.result_id}`);
    state.activeResult = result;
    state.lastAnalysisRequest = request;
    state.isSavedResult = false;
    state.refreshFailed = false;
    const servedFromCache = result.source_state === "cached_nasa_response";
    $("#sourceState").className = servedFromCache ? "source-state saved" : "source-state live";
    $("#sourceState").innerHTML = servedFromCache ? "<i></i> NASA DATA · CACHED" : "<i></i> LIVE FROM NASA";
    $("#analysisDateStamp").textContent = new Date(result.created_at).toLocaleDateString();
    renderAnalysis();
    setAnalysisPanelVisible(true, true);
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
    const progress = $("#progressPanel");
    if (progress) progress.hidden = true;
  }
}
$("#runAnalysis")?.addEventListener("click", () => runAnalysis());

function renderLoadingAnalysis() {
  $("#analysisPanel")?.classList.remove("is-compare");
  $("#analysisContent").innerHTML = `<div class="empty-analysis"><div class="empty-orbit">◌</div><h4>Following the signal.</h4><p>EarthTrace is retrieving the requested NASA series, checking its coverage, and preparing the statistical tests.</p><div class="empty-steps"><span>RETRIEVE</span><span>CHECK</span><span>ANALYZE</span></div></div>`;
}
function renderAnalysisError(message) {
  $("#analysisPanel")?.classList.remove("is-compare");
  $("#analysisContent").innerHTML = `<div class="empty-analysis"><div class="empty-orbit" style="color:#d28b76;border-color:rgba(210,139,118,.35)">!</div><h4>No result was produced.</h4><p>${esc(message)}</p><div class="empty-steps"><span>CHECK INPUT</span><span>CHECK NETWORK</span><span>RETRY</span></div></div>`;
}
function renderEmptyAnalysis() {
  $("#analysisPanel")?.classList.remove("is-compare");
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
  const popup = $("#analysisPanel");
  syncCompareButton();
  if (state.activeComparison) {
    popup?.classList.add("is-compare");
    panel.innerHTML = renderComparisonView(state.activeComparison);
    attachAnalysisActions();
    requestAnimationFrame(() => renderSeriesChart(result));
    return;
  }
  popup?.classList.remove("is-compare");
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
    ${verdictMarkup(result)}
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
    <div class="panel-action-row report-actions">
      <button class="small-action" data-action="series">Open full time-series analysis ↗</button>
      <button class="small-action" data-action="extend">Try a longer period ↗</button>
      <button class="small-action" data-action="refresh">Refresh from NASA ↻</button>
    </div>`;
}

function verdictMarkup(result) {
  const t = result.trend;
  const unit = result.variable.unit;
  const significant = ["significant_increasing_trend", "significant_decreasing_trend"].includes(t.classification);
  const early = ["insufficient_data", "exploratory_result"].includes(t.classification);
  const perDecade = Number(t.slope_per_decade);
  const dir = !Number.isFinite(perDecade) || Math.abs(perDecade) < 1e-9 ? "flat" : perDecade > 0 ? "up" : "down";
  const word = dir === "up" ? "rising" : dir === "down" ? "falling" : "steady";
  const arrow = dir === "up" ? "↗" : dir === "down" ? "↘" : "→";
  const name = result.variable.name;
  const period = `${result.period.actual_first_observation.slice(0, 4)}–${result.period.actual_last_observation.slice(0, 4)}`;
  let headline;
  let detail;
  if (early) {
    headline = "Too early to call";
    detail = `The record is short or incomplete, so this ${word} estimate is exploratory. Try a longer period.`;
  } else if (significant) {
    headline = `${name} is ${word}`;
    detail = `It changes by ${numberFormat(Math.abs(perDecade), 3)} ${esc(unit)} per decade at ${esc(result.region.name)} (${period}). This is statistically significant at the 95% level, so random variation is an unlikely explanation.`;
  } else {
    headline = `A ${word} tendency — not yet significant`;
    detail = `The estimate is ${numberFormat(Math.abs(perDecade), 3)} ${esc(unit)} per decade (${period}), but it is within what random variation can produce. A longer record may settle it.`;
  }
  return `<div class="verdict ${significant ? dir : "flat"}"><div class="verdict-arrow" aria-hidden="true">${arrow}</div><div><strong>${esc(headline)}</strong><p>${detail}</p></div></div>`;
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

function renderComparisonView(comparison) {
  const a = comparison.region_a;
  const b = comparison.region_b;
  return `
    <div class="compare-legend">
      <span><i class="legend-dot" style="background:#59c2d0"></i><b>A</b> ${esc(a.region.name)}</span>
      <span><i class="legend-dot" style="background:#a98bff"></i><b>B</b> ${esc(b.region.name)}</span>
      <span style="color:var(--muted)">Monthly anomaly · ${esc(a.variable.unit)}</span>
    </div>
    <div class="compare-chart"><canvas id="seriesChart" aria-label="Monthly anomaly of point A and point B"></canvas></div>
    ${renderComparisonSummary(comparison)}
    <div class="compare-actions">
      <button class="small-action" data-action="single">Back to single-point report</button>
    </div>`;
}

function renderComparisonSummary(comparison) {
  const a = comparison.region_a;
  const b = comparison.region_b;
  const diff = comparison.slope_difference_test;
  const unit = a.variable.unit;
  const coord = (region) => `${numberFormat(region.latitude, 3)}°, ${numberFormat(region.longitude, 3)}°`;
  const interval = (t) => `[${numberFormat(t.confidence_interval_95[0], 4)}, ${numberFormat(t.confidence_interval_95[1], 4)}]`;
  const rows = [
    ["Trend / year", `${numberFormat(a.trend.slope_per_year, 5)} ${unit}`, `${numberFormat(b.trend.slope_per_year, 5)} ${unit}`, `${numberFormat(diff.difference_per_year, 5)} ${unit}/year`],
    ["Trend / decade", `${numberFormat(a.trend.slope_per_decade, 4)} ${unit}`, `${numberFormat(b.trend.slope_per_decade, 4)} ${unit}`, `${numberFormat(Number(diff.difference_per_year) * 10, 4)} ${unit}/decade`],
    ["p-value", numberFormat(a.trend.p_value, 5), numberFormat(b.trend.p_value, 5), `Difference p = ${numberFormat(diff.p_value, 5)}`],
    ["95% slope interval", interval(a.trend), interval(b.trend), diff.confidence_interval_95 ? `[${numberFormat(diff.confidence_interval_95[0], 4)}, ${numberFormat(diff.confidence_interval_95[1], 4)}]` : "—"],
    ["Mann–Kendall τ", numberFormat(a.mann_kendall.tau, 4), numberFormat(b.mann_kendall.tau, 4), "—"],
    ["Valid months", `${a.quality.valid_observations} / ${a.quality.expected_observations}`, `${b.quality.valid_observations} / ${b.quality.expected_observations}`, "—"],
  ];
  const body = rows.map((row) => `<tr><th scope="row">${esc(row[0])}</th><td>${esc(row[1])}</td><td>${esc(row[2])}</td><td>${esc(row[3])}</td></tr>`).join("");
  return `<section class="comparison-report" aria-label="Comparison table"><div class="comparison-table-wrap"><table class="comparison-table"><thead><tr>
    <th>INDICATOR</th>
    <th><span class="comparison-col-title"><i class="point-dot point-dot-a"></i> POINT A</span><strong>${esc(a.region.name)}</strong><small>${coord(a.region)}</small></th>
    <th><span class="comparison-col-title"><i class="point-dot point-dot-b"></i> POINT B</span><strong>${esc(b.region.name)}</strong><small>${coord(b.region)}</small></th>
    <th>DIFFERENCE · TEST</th></tr></thead><tbody>${body}</tbody></table></div></section>`;
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
  svg.innerHTML = `<defs><linearGradient id="timelineAreaGradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#59c2d0" stop-opacity=".28"/><stop offset="1" stop-color="#59c2d0" stop-opacity="0"/></linearGradient></defs>${grid}<path class="timeline-area" d="${pathA} L 966 150 L 34 150 Z"/><path class="timeline-line timeline-line-a" d="${pathA}"/>${pathB ? `<path class="timeline-line timeline-line-b" d="${pathB}"/>` : ""}<line id="timelineCursor" class="timeline-cursor" x1="${xAt(rows.length-1)}" y1="18" x2="${xAt(rows.length-1)}" y2="154"/><circle id="timelinePointA" class="timeline-point timeline-point-a" cx="${xAt(rows.length-1)}" cy="${yAt(rows[rows.length-1].a ?? min)}" r="5"/>${compare ? `<circle id="timelinePointB" class="timeline-point timeline-point-b" cx="${xAt(rows.length-1)}" cy="${yAt(rows[rows.length-1].b ?? min)}" r="5"/>` : ""}`;
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
    <div class="chart-legend"><span><i class="legend-dot" style="background:#59c2d0"></i>${isComparison ? esc(state.activeComparison.region_a.region.name) : "Monthly anomaly"}</span><span><i class="legend-dot" style="background:#a98bff"></i>${isComparison ? esc(state.activeComparison.region_b.region.name) : "OLS-HAC fit"}</span></div>
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
    else if (action === "single") {
      state.activeComparison = null;
      const single = state.activeResult.region;
      addSelectionMarker({ lat: single.latitude, lon: single.longitude });
      $("#analysisRegionTitle").textContent = single.name;
      $("#analysisVariableSubtitle").textContent = state.activeResult.variable.name;
      setActiveTab("overview");
    }
    else if (action === "extend") extendCurrentAnalysis();
    else if (action === "refresh") refreshCurrentAnalysis();
    else if (action === "export-csv") downloadResult("csv");
    else if (action === "export-json") downloadResult("json");
    else if (action === "raw-chart") renderSeriesChart(state.activeResult, true);
  }));
}

function downloadResult(format) {
  const result = state.activeResult;
  if (!result) return;
  const slug = String(result.region?.name || "region").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  const base = `earthtrace-${result.variable.id}-${slug}`;
  let blob;
  let filename;
  if (format === "csv") {
    const quote = (value) => `"${String(value).replace(/"/g, '""')}"`;
    const rows = [["date", "value", "anomaly", "unit", "variable_id", "region", "latitude", "longitude"]];
    result.series.forEach((row) => rows.push([row.date, row.value, row.anomaly, quote(result.variable.unit), result.variable.id, quote(result.region.name), result.region.latitude, result.region.longitude]));
    blob = new Blob([rows.map((row) => row.join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    filename = `${base}.csv`;
  } else {
    blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    filename = `${base}.json`;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
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
    datasets.push({ label: a.region.name, data: alignedLabels.map((stamp) => aMap.has(stamp) ? aMap.get(stamp) : null), borderColor: "#59c2d0", pointRadius: 0, borderWidth: 1.7, tension: 0.12, spanGaps: false });
    datasets.push({ label: b.region.name, data: alignedLabels.map((stamp) => bMap.has(stamp) ? bMap.get(stamp) : null), borderColor: "#a98bff", pointRadius: 0, borderWidth: 1.7, tension: 0.12, spanGaps: false });
    state.chart = createLineChart(canvas, alignedLabels, datasets, `Monthly anomaly (${a.variable.unit})`);
    return;
  }
  datasets.push({ label: raw ? "Original monthly value" : "Monthly anomaly", data: raw ? values : anomalyValues, borderColor: "#59c2d0", backgroundColor: "rgba(89,194,208,.08)", pointRadius: 0, borderWidth: 1.7, fill: true, tension: 0.15 });
  if (!raw && result.trend.fitted_values) datasets.push({ label: "OLS-HAC fitted trend", data: result.trend.fitted_values, borderColor: "#a98bff", pointRadius: 0, borderWidth: 1.3, borderDash: [5, 5], tension: 0 });
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
      plugins: { legend: { display: false }, tooltip: { backgroundColor: "#202b36", borderColor: "rgba(150,177,202,.2)", borderWidth: 1, titleFont: { family: "DM Mono", size: 12 }, bodyFont: { family: "Manrope", size: 12 }, displayColors: true } },
      scales: {
        x: { grid: { color: "rgba(150,177,202,.07)" }, ticks: { color: "#718599", maxTicksLimit: 7, font: { family: "DM Mono", size: 11 } }, border: { display: false } },
        y: { title: { display: true, text: yTitle, color: "#8092a4", font: { family: "DM Mono", size: 11 } }, grid: { color: "rgba(150,177,202,.07)" }, ticks: { color: "#718599", font: { family: "DM Mono", size: 11 } }, border: { display: false } },
      },
    },
  });
}

function syncCompareButton() {
  const button = $("#compareRail");
  if (!button) return;
  const ready = Boolean(state.activeResult);
  button.disabled = !ready;
  button.classList.toggle("is-armed", state.comparisonMode);
  const hint = $("#compareHint");
  if (hint) hint.textContent = state.comparisonMode ? "Now click a second point on the globe, or choose a place from the list."
    : ready ? `Compare ${state.activeResult.region.name} with a second point, using the same dataset and dates.`
    : "Run an analysis first, then pick a second point to compare against it.";
}
$("#compareRail")?.addEventListener("click", () => { if (state.activeResult) startComparisonSelection(); });

function startComparisonSelection() {
  state.comparisonMode = true;
  syncCompareButton();
  toast("Select a second point on the globe. The dataset, variable, dates and method will stay the same.", "info", 5500);
  $("#mapHint").innerHTML = "<span>✣</span> SELECT A SECOND POINT TO COMPARE";
  $("#analysisRegionTitle").textContent = "Choose comparison point";
  setAnalysisPanelVisible(false);
}

async function runComparison(regionB, requestOverride = null) {
  if (!state.activeResult || !state.lastAnalysisRequest) return;
  setAnalysisPanelVisible(true);
  renderLoadingAnalysis();
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
    setAnalysisPanelVisible(true, true);
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
      renderAnalysis();
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
  if (!state.activeResult || !state.lastAnalysisRequest) return;
  const latestPublishedYear = new Date().getUTCFullYear() - 1;
  $("#startYear").value = "1981";
  $("#endYear").value = String(latestPublishedYear);
  toast(`Re-running the same point and method over 1981–${latestPublishedYear}…`);
  state.activeComparison = null;
  await runAnalysis(null, { ...state.lastAnalysisRequest, start_date: "1981-01-01", end_date: `${latestPublishedYear}-12-01`, force_refresh: false });
}

// The report is a pop-up screen that opens from the selected point on the globe.
function positionPopupOrigin() {
  const popup = $("#analysisPanel");
  const stage = $("#earthStage");
  if (!popup || !stage) return;
  let x = popup.offsetWidth / 2;
  let y = popup.offsetHeight / 2;
  try {
    if (THREE && earthMesh && globeCamera && globeRenderer && state.selectedRegion) {
      const point = pointToVector(state.selectedRegion.lat, state.selectedRegion.lon, 1.475);
      earthMesh.localToWorld(point);
      point.project(globeCamera);
      const canvasRect = globeRenderer.domElement.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      x = canvasRect.left + ((point.x + 1) / 2) * canvasRect.width - stageRect.left - popup.offsetLeft;
      y = canvasRect.top + ((1 - point.y) / 2) * canvasRect.height - stageRect.top - popup.offsetTop;
    }
  } catch { /* fall back to the centre */ }
  popup.style.setProperty("--ox", `${Math.round(Math.min(Math.max(x, 0), popup.offsetWidth))}px`);
  popup.style.setProperty("--oy", `${Math.round(Math.min(Math.max(y, 0), popup.offsetHeight))}px`);
}

let popupCloseTimer = 0;
function setAnalysisPanelVisible(visible) {
  const popup = $("#analysisPanel");
  if (!popup) return;
  const scrim = $("#analysisScrim");
  window.clearTimeout(popupCloseTimer);
  popup.classList.remove("is-closing"); scrim?.classList.remove("is-closing");
  if (visible) {
    const wasHidden = popup.hidden;
    popup.hidden = false;
    if (scrim) scrim.hidden = false;
    if (wasHidden) positionPopupOrigin();
  } else if (!popup.hidden) {
    popup.classList.add("is-closing"); scrim?.classList.add("is-closing");
    popupCloseTimer = window.setTimeout(() => {
      popup.hidden = true; if (scrim) scrim.hidden = true;
      popup.classList.remove("is-closing"); scrim?.classList.remove("is-closing");
    }, 200);
  }
  $("#showAnalysis").hidden = Boolean(visible) || !state.activeResult;
}
$("#collapseAnalysis")?.addEventListener("click", () => setAnalysisPanelVisible(false));
$("#analysisScrim")?.addEventListener("click", () => setAnalysisPanelVisible(false));
$("#showAnalysis")?.addEventListener("click", () => setAnalysisPanelVisible(true));
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (document.querySelector(".modal-backdrop:not([hidden])")) return;
  if (!$("#analysisPanel")?.hidden) setAnalysisPanelVisible(false);
});

// ---------------------------------------------------------------------------
// SAVED INVESTIGATIONS
// ---------------------------------------------------------------------------
const SAVE_KEY = "earthtrace.saved.v1";
function readSaved() { try { return JSON.parse(localStorage.getItem(SAVE_KEY) || "[]"); } catch { return []; } }
function writeSaved(list) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(list)); return true; } catch { return false; } }

$("#saveInvestigation")?.addEventListener("click", () => {
  if (!state.activeResult) {
    toast("Complete an analysis before saving an investigation.");
    return;
  }
  const title = `${state.activeResult.variable.name} · ${state.activeResult.region.name}`;
  const item = {
    investigation_id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    title,
    created_at: new Date().toISOString(),
    payload: { result_id: state.activeResult.result_id, result: state.activeResult, comparison: state.activeComparison },
  };
  const next = [item, ...readSaved()].slice(0, 25);
  if (writeSaved(next)) toast(`Saved in this browser: ${title}`, "success");
  else toast("Could not save: this browser's storage is full or blocked.", "error");
});

// Saved investigations: the exact output and its evidence, kept in this browser.
$("#viewSavedInvestigations")?.addEventListener("click", openSavedInvestigations);
function openSavedInvestigations() {
  const list = $("#savedInvestigationList");
  showModal("savedModal");
  const saved = readSaved();
  if (!saved.length) {
    list.innerHTML = `<div class="empty-analysis"><div class="empty-orbit">◎</div><h4>No saved investigations yet.</h4><p>Run an analysis in Earth Explorer, then choose Save investigation.</p></div>`;
    return;
  }
  list.innerHTML = saved.map((item) => `<div class="saved-study-row"><div><h4>${esc(item.title)}</h4><p>${esc(new Date(item.created_at).toLocaleString())}</p></div><div class="panel-action-row" style="margin:0"><button class="small-action" data-open-saved="${esc(item.investigation_id)}">Open evidence ↗</button><button class="small-action" data-delete-saved="${esc(item.investigation_id)}" aria-label="Delete ${esc(item.title)}">Delete</button></div></div>`).join("");
  $$('[data-open-saved]', list).forEach((button) => button.addEventListener("click", () => loadSavedInvestigation(button.dataset.openSaved)));
  $$('[data-delete-saved]', list).forEach((button) => button.addEventListener("click", () => {
    writeSaved(readSaved().filter((item) => item.investigation_id !== button.dataset.deleteSaved));
    openSavedInvestigations();
  }));
}
function loadSavedInvestigation(id) {
  try {
    const saved = readSaved().find((item) => item.investigation_id === id);
    if (!saved) throw new Error("This saved record was not found in this browser.");
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
// GLOBAL SCAN — the same trend test at 24 sample places, painted on the globe.
// One variable can rise in one region and fall in another; this makes that visible.
// ---------------------------------------------------------------------------
const SCAN = { batch: 4, parallel: 2, hitDegrees: 5.5 };
let scanGroup = null;

function setScanUi(active) {
  $("#scanLegend").hidden = !active;
  $("#scanPanel").hidden = !active;
}

function clearScan() {
  const previous = state.scan;
  state.scan = { token: previous.token + 1, running: false, points: previous.points, results: new Map(), variable: null, start: null, end: null, born: new Map() };
  setScanUi(false);
  hideScanTooltip();
  const button = $("#scanGlobe");
  if (button) { button.classList.remove("busy"); button.querySelector("span").textContent = "Scan the globe"; }
  paintScanOnGlobe();
}

const signedNumber = (value, decimals = 3) => `${Number(value) > 0 ? "+" : ""}${numberFormat(value, decimals)}`;

async function runGlobeScan() {
  const scan = state.scan;
  if (scan.running) return;
  let request;
  try { request = currentAnalysisRequest({ lat: 0, lon: 0, name: "scan" }); }
  catch (error) { toast(error.message, "error"); return; }
  if (!state.globeReady) initializeGlobe();
  if (!scan.points.length) {
    try { scan.points = (await apiRequest("/api/catalog/scan-points")).points || []; }
    catch (error) { toast(`Could not load the scan locations: ${error.message}`, "error"); return; }
  }
  const token = scan.token + 1;
  Object.assign(scan, {
    token, running: true, results: new Map(), born: new Map(), variable: request.variable_id,
    start: Number(request.start_date.slice(0, 4)), end: Number(request.end_date.slice(0, 4)),
  });
  const button = $("#scanGlobe");
  button.classList.add("busy");
  button.querySelector("span").textContent = "Scanning…";
  setScanUi(true);
  renderScan();
  paintScanOnGlobe();
  $("#earthStage")?.scrollIntoView({ behavior: "smooth", block: "center" });

  const batches = [];
  for (let i = 0; i < scan.points.length; i += SCAN.batch) batches.push(scan.points.slice(i, i + SCAN.batch));
  let next = 0;
  const worker = async () => {
    while (next < batches.length && scan.token === token) {
      const group = batches[next];
      next += 1;
      try {
        const data = await apiRequest("/api/analysis/scan-batch", {
          method: "POST",
          body: JSON.stringify({ variable_id: scan.variable, start_year: scan.start, end_year: scan.end, point_ids: group.map((point) => point.id) }),
        });
        if (scan.token !== token) return;
        (data.results || []).forEach((item) => scan.results.set(item.id, item));
      } catch (error) {
        if (scan.token !== token) return;
        group.forEach((point) => scan.results.set(point.id, { ...point, ok: false, error: error.message }));
      }
      renderScan();
      paintScanOnGlobe();
    }
  };
  await Promise.all(Array.from({ length: SCAN.parallel }, worker));
  if (scan.token !== token) return;
  scan.running = false;
  button.classList.remove("busy");
  button.querySelector("span").textContent = "Scan again";
  renderScan();
  paintScanOnGlobe();
  const ok = [...scan.results.values()].filter((item) => item.ok);
  if (!ok.length) toast("No place returned data. Check the connection and try again; nothing was simulated.", "error", 7000);
  else toast(`Scan complete: ${ok.filter((item) => item.significant).length} of ${ok.length} places show a significant trend.`, "success", 6000);
}
$("#scanGlobe")?.addEventListener("click", runGlobeScan);
$("#scanClose")?.addEventListener("click", () => { $("#scanPanel").hidden = true; });
$("#scanList")?.addEventListener("click", (event) => {
  const row = event.target.closest("[data-scan-id]");
  if (row && !row.disabled) openScanPoint(row.dataset.scanId);
});

function openScanPoint(id) {
  const item = state.scan.results.get(id);
  if (!item || !item.ok) return;
  hideScanTooltip();
  selectRegion({ type: "Point", lat: item.lat, lon: item.lon, name: item.name });
  runAnalysis();
}

function renderScan() {
  const scan = state.scan;
  if (!scan.variable) return;
  const variable = state.variables.get(scan.variable) || { name: scan.variable, unit: "" };
  const unit = variable.unit;
  const total = scan.points.length;
  const finished = scan.points.filter((point) => scan.results.has(point.id)).length;
  const ok = [...scan.results.values()].filter((item) => item.ok);
  const sig = ok.filter((item) => item.significant);
  const sigUp = sig.filter((item) => item.slope_per_decade > 0).length;
  const sigDown = sig.length - sigUp;
  $("#scanTitle").textContent = `${variable.name}: where is it changing?`;
  $("#scanSubtitle").textContent = `${scan.start}–${scan.end} · monthly NASA POWER · ${finished} of ${total} places analysed`;
  $("#scanState").className = scan.running ? "source-state" : "source-state live";
  $("#scanState").innerHTML = scan.running ? `<i></i> SCANNING ${finished}/${total}` : "<i></i> SCAN COMPLETE";
  $("#scanStatus").textContent = scan.running ? `SCANNING ${finished} / ${total}…` : `${ok.length} PLACES · ${sig.length} SIGNIFICANT`;
  $("#scanLegendTitle").textContent = `${variable.name.toUpperCase()} · ${unit}/DECADE`;

  let message;
  if (!ok.length) message = scan.running ? "Waiting for the first places to return…" : "No place returned data.";
  else if (sigUp && sigDown) message = `A mixed signal: ${sigUp} place${sigUp > 1 ? "s" : ""} rise${sigUp > 1 ? "" : "s"} significantly and ${sigDown} fall${sigDown > 1 ? "" : "s"}, even though one planet drives both. This is why a single global number can hide real change.`;
  else if (sig.length) message = `Significant change appears in ${sig.length} of ${ok.length} places, all ${sigUp ? "increasing" : "decreasing"}.`;
  else message = scan.running ? "No significant trend yet — more places are still arriving." : "No sampled place shows a significant trend over this period. A longer record can still reveal one.";
  const rise = ok.filter((item) => item.slope_per_decade > 0).sort((a, b) => b.slope_per_decade - a.slope_per_decade)[0];
  const fall = ok.filter((item) => item.slope_per_decade < 0).sort((a, b) => a.slope_per_decade - b.slope_per_decade)[0];
  const extreme = (label, item, cls) => item ? `<div><strong>${label}</strong><span class="${cls}">${esc(item.name)}</span> ${signedNumber(item.slope_per_decade)} ${esc(unit)}/decade${item.significant ? "" : " (not significant)"}</div>` : "";
  $("#scanSummary").innerHTML = `
    <p class="interpretation" style="margin:0">${esc(message)}</p>
    <div class="scan-counts"><div class="c-up"><b>${ok.filter((item) => item.slope_per_decade > 0).length}</b><span>INCREASING</span></div><div class="c-down"><b>${ok.filter((item) => item.slope_per_decade < 0).length}</b><span>DECREASING</span></div><div><b>${sig.length}</b><span>SIGNIFICANT</span></div></div>
    <div class="scan-extremes">${extreme("STRONGEST RISE", rise, "up")}${extreme("STRONGEST FALL", fall, "down")}</div>`;

  const maxAbs = Math.max(1e-12, ...ok.map((item) => Math.abs(item.slope_per_decade)));
  const rank = (point) => { const item = scan.results.get(point.id); return !item ? -2 : !item.ok ? -1 : item.slope_per_decade; };
  const ordered = [...scan.points].sort((a, b) => rank(b) - rank(a));
  $("#scanList").innerHTML = ordered.map((point) => {
    const item = scan.results.get(point.id);
    const name = `<div class="scan-name"><strong>${esc(point.name)}</strong><small>${esc(point.biome)} · ${Number(point.lat).toFixed(1)}°, ${Number(point.lon).toFixed(1)}°</small></div>`;
    if (!item) return `<button class="scan-row pending" role="listitem" disabled>${name}<div class="scan-bar"></div><div class="scan-val">…</div><div class="scan-badge nsig">QUEUED</div></button>`;
    if (!item.ok) return `<button class="scan-row pending" role="listitem" disabled title="${esc(item.error || "")}">${name}<div class="scan-bar"></div><div class="scan-val">—</div><div class="scan-badge err">UNAVAILABLE</div></button>`;
    const width = Math.min(50, (Math.abs(item.slope_per_decade) / maxAbs) * 50);
    const up = item.slope_per_decade >= 0;
    return `<button class="scan-row" role="listitem" data-scan-id="${esc(item.id)}" title="Open the full analysis for ${esc(item.name)}">${name}<div class="scan-bar"><i class="${up ? "up" : "down"}${item.significant ? "" : " weak"}" style="width:${width.toFixed(1)}%"></i></div><div class="scan-val">${signedNumber(item.slope_per_decade)} <small>${esc(unit)}/dec</small></div><div class="scan-badge ${item.significant ? "sig" : "nsig"}">${item.significant ? "SIGNIFICANT" : "NOT SIG."}</div></button>`;
  }).join("");
}

// --- On the globe: a bar per place. Height = size of the change, colour = direction, solid = significant. ---
function disposeGroup(group) {
  [...group.children].forEach((child) => {
    child.geometry?.dispose?.();
    child.material?.dispose?.();
    group.remove(child);
  });
}

function paintScanOnGlobe() {
  if (!THREE || !earthMesh) return;
  if (!scanGroup) { scanGroup = new THREE.Group(); earthMesh.add(scanGroup); }
  disposeGroup(scanGroup);
  const ok = [...state.scan.results.values()].filter((item) => item.ok);
  if (!ok.length) return;
  const maxAbs = Math.max(1e-12, ...ok.map((item) => Math.abs(item.slope_per_decade)));
  const now = performance.now();
  ok.forEach((item) => {
    if (!state.scan.born.has(item.id)) state.scan.born.set(item.id, now);
    const up = item.slope_per_decade >= 0;
    const color = up ? 0xb89cff : 0x59c2d0;
    const height = 0.07 + 0.45 * Math.pow(Math.abs(item.slope_per_decade) / maxAbs, 0.8);
    const normal = pointToVector(item.lat, item.lon, 1).normalize();
    const geometry = new THREE.CylinderGeometry(0.017, 0.017, height, 10);
    geometry.translate(0, height / 2, 0);   // base sits on the surface, bar grows outward
    const bar = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: item.significant ? 0.96 : 0.4 }));
    bar.position.copy(normal.clone().multiplyScalar(1.452));
    bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    bar.userData = { born: state.scan.born.get(item.id), id: item.id };
    scanGroup.add(bar);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.03, item.significant ? 0.046 : 0.038, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: item.significant ? 0.9 : 0.35, side: THREE.DoubleSide }),
    );
    ring.position.copy(normal.clone().multiplyScalar(1.456));
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    scanGroup.add(ring);
  });
}

function animateScanBars() {
  if (!scanGroup) return;
  const now = performance.now();
  scanGroup.children.forEach((child) => {
    const born = child.userData?.born;
    if (born === undefined || child.userData.grown) return;
    const t = Math.min(1, (now - born) / 750);
    child.scale.y = 1 - Math.pow(1 - t, 3);
    if (t >= 1) child.userData.grown = true;
  });
}

function nearestScanResult(lat, lon) {
  const rad = Math.PI / 180;
  const limit = Math.cos(SCAN.hitDegrees * rad);
  let best = null;
  let bestDot = limit;
  state.scan.results.forEach((item) => {
    if (!item.ok) return;
    const dot = Math.sin(lat * rad) * Math.sin(item.lat * rad) + Math.cos(lat * rad) * Math.cos(item.lat * rad) * Math.cos((lon - item.lon) * rad);
    if (dot > bestDot) { bestDot = dot; best = item; }
  });
  return best;
}

function hideScanTooltip() { const tip = $("#scanTooltip"); if (tip) tip.hidden = true; }
let hoverQueued = false;
let hoverEvent = null;
function onGlobeHover(event) {
  if (event.pointerType === "touch" || event.buttons || !state.scan.results.size) { hideScanTooltip(); return; }
  hoverEvent = event;
  if (hoverQueued) return;
  hoverQueued = true;
  requestAnimationFrame(() => {
    hoverQueued = false;
    const canvas = globeRenderer?.domElement;
    const spot = hoverEvent ? globeSurfacePoint(hoverEvent) : null;
    const item = spot ? nearestScanResult(spot.lat, spot.lon) : null;
    if (!item) { hideScanTooltip(); if (canvas) canvas.style.cursor = ""; return; }
    if (canvas) canvas.style.cursor = "pointer";
    const unit = state.variables.get(state.scan.variable)?.unit || "";
    const tip = $("#scanTooltip");
    const host = $(".stage-globe-area").getBoundingClientRect();
    tip.innerHTML = `<strong>${esc(item.name)}</strong>${esc(item.biome)}<br /><b class="${item.slope_per_decade >= 0 ? "up" : "down"}">${signedNumber(item.slope_per_decade)} ${esc(unit)}/decade</b><br />p = ${numberFormat(item.p_value, 4)} · ${item.significant ? "SIGNIFICANT" : "not significant"}<br />${numberFormat(item.coverage, 0)}% coverage · click to open`;
    tip.hidden = false;
    tip.style.left = `${Math.max(8, Math.min(hoverEvent.clientX - host.left + 14, host.width - tip.offsetWidth - 8))}px`;
    tip.style.top = `${Math.max(8, Math.min(hoverEvent.clientY - host.top + 14, host.height - tip.offsetHeight - 8))}px`;
  });
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
      <div class="recommendation"><div><h4>${esc(item.name)} <span style="color:var(--accent);font:9px var(--mono)">${esc(item.unit)}</span></h4><p>${esc(item.why)}</p></div><button class="small-action" data-pick-variable="${esc(item.variable_id)}">Explore this ↗</button></div>`).join("");
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
  toast("Study loaded — retrieving the live NASA series…");
  window.setTimeout(() => runAnalysis(), 700);
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

// ---------------------------------------------------------------------------
// NAVIGATION, ABOUT, ACCESSIBILITY
// ---------------------------------------------------------------------------
const menuButton = $("#menuButton");
const mainNav = $("#mainNav");
function moveNavIndicator() {
  const indicator = $(".nav-indicator");
  const active = $(".nav-link.active");
  if (!indicator || !active || !mainNav || getComputedStyle(mainNav).display === "none" || mainNav.classList.contains("open")) return;
  indicator.style.width = `${active.offsetWidth}px`;
  indicator.style.height = `${active.offsetHeight}px`;
  indicator.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
  indicator.classList.add("is-ready");
}
window.addEventListener("resize", () => window.requestAnimationFrame(moveNavIndicator));
document.fonts?.ready?.then(() => moveNavIndicator());

function setMenu(open) {
  mainNav?.classList.toggle("open", open);
  menuButton?.setAttribute("aria-expanded", open ? "true" : "false");
  menuButton?.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  if (menuButton) menuButton.textContent = open ? "×" : "☰";
}
menuButton?.addEventListener("click", () => setMenu(!mainNav.classList.contains("open")));
$$(".nav-link").forEach((link) => link.addEventListener("click", () => setMenu(false)));
document.addEventListener("keydown", (event) => { if (event.key === "Escape") setMenu(false); });
window.addEventListener("resize", () => { if (window.innerWidth > 850) setMenu(false); });

$("#aboutButton")?.addEventListener("click", () => {
  toast("EarthTrace is a scientific investigation interface. Its first working data adapter uses NASA POWER monthly MERRA-2-derived point series.", "info", 6500);
});

// Motion preference is applied explicitly for app transitions as well as CSS.

// Initialize catalogue and health. No external data request runs until a user starts an analysis.
initializeApplication();


// ---------------------------------------------------------------------------
// SKY — the fall from space to the ground. Every tab is a scene (stars and aurora up
// high, thin cloud, thick cloud with rain, mist and pollen at the surface). Changing
// tab plays a short "descent": stars and wind streak past, a band of light sweeps
// through and the altitude counter runs down. Stars lean away from the pointer, join
// into faint constellations, trail sparkles behind it and react to clicks with a ring,
// a shove and a few sparks. Canvas at ~30 fps; sleeps while the 3D globe is open.
// ---------------------------------------------------------------------------
const SKY_SCENES = [
  { stars: 1,    aurora: 0,   clouds: 0,    haze: 0,    rain: 0,   pollen: 0,    meteor: 1,   limb: 1,    ground: 0 },    // observatory · orbit
  { stars: 0.95, aurora: 1,   clouds: 0,    haze: 0,    rain: 0,   pollen: 0,    meteor: 1,   limb: 0.7,  ground: 0 },    // how it works · thermosphere
  { stars: 0.55, aurora: 0.4, clouds: 0.4,  haze: 0.2,  rain: 0,   pollen: 0,    meteor: 0.6, limb: 0.3,  ground: 0 },    // data detective · mesosphere
  { stars: 0.2,  aurora: 0,   clouds: 0.7,  haze: 0.4,  rain: 0,   pollen: 0,    meteor: 0,   limb: 0.05, ground: 0 },    // explorer · stratosphere
  { stars: 0,    aurora: 0,   clouds: 1,    haze: 0.75, rain: 0.8, pollen: 0.15, meteor: 0,   limb: 0,    ground: 0.4 },  // hydrology · troposphere
  { stars: 0,    aurora: 0,   clouds: 0.6,  haze: 1,    rain: 0,   pollen: 1,    meteor: 0,   limb: 0,    ground: 1 },    // team · surface
];
const skyFx = (() => {
  const canvas = $("#skyFx");
  const skyEl = $("#sky");
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return null;
  const palette = [[231, 237, 242], [154, 215, 230], [201, 189, 255]];
  const pointer = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, px: 0, py: 0, glow: 0, glowTarget: 0, down: false, trailAt: 0 };
  const cur = { ...SKY_SCENES[0] };
  let target = SKY_SCENES[0];
  let width = 0, height = 0, dpr = 1, stars = [], drops = [], motes = [], streaks = [];
  let frame = 0, last = 0, awake = true, meteor = null, nextMeteor = performance.now() + 2500;
  let warp = null, ripples = [], sparks = [], trail = [], lastVars = "";

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    width = window.innerWidth; height = window.innerHeight;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    const count = Math.max(70, Math.min(150, Math.round((width * height) / 12500)));
    stars = Array.from({ length: count }, () => ({
      x: Math.random(), y: Math.random(), z: 0.25 + Math.random() * 0.75,
      r: 0.7 + Math.random() * 1.3, phase: Math.random() * 6.28, tw: 0.5 + Math.random(),
      c: palette[Math.floor(Math.random() * palette.length)], ox: 0, oy: 0, vx: 0, vy: 0,
    }));
    drops = Array.from({ length: 80 }, () => ({ x: Math.random(), y: Math.random(), z: 0.4 + Math.random() * 0.6, len: 12 + Math.random() * 18 }));
    motes = Array.from({ length: 40 }, () => ({ x: Math.random(), y: Math.random(), r: 1 + Math.random() * 1.8, phase: Math.random() * 6.28, v: 0.004 + Math.random() * 0.01 }));
    streaks = Array.from({ length: 48 }, () => ({ x: Math.random(), y0: Math.random(), z: 0.35 + Math.random() * 0.65 }));
    paint(performance.now(), 0);
  }

  const sparkColor = () => (cur.rain > 0.3 ? [170, 215, 245] : cur.pollen > 0.3 ? [170, 245, 215] : cur.stars > 0.4 ? [210, 230, 255] : [180, 225, 245]);
  function burst(x, y, power = 1) {
    const now = performance.now();
    ripples.push({ x, y, t0: now });
    const c = sparkColor();
    for (let i = 0; i < 12 && sparks.length < 90; i++) {
      const a = Math.random() * 6.283, sp = (1.2 + Math.random() * 3.2) * power;
      sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t0: now, life: 650 + Math.random() * 400, c });
    }
    for (const s of stars) {
      const sx = s.x * width + s.ox, sy = s.y * height + s.oy, dx = sx - x, dy = sy - y, d = Math.hypot(dx, dy);
      if (d < 260 && d > 1) { const f = (1 - d / 260) * 9 * power * s.z; s.vx += (dx / d) * f; s.vy += (dy / d) * f; }
    }
  }
  function lerpScene(k) { for (const key in target) cur[key] += (target[key] - cur[key]) * k; }

  function paint(now, dt) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const ds = dt ? dt / 16.7 : 0;
    const px = (pointer.x - 0.5) * 24, py = (pointer.y - 0.5) * 18;
    const mx = pointer.x * width, my = pointer.y * height;
    const near = [];
    let amt = 0, dir = 1;
    if (warp) { const k = Math.max(0, (now - warp.t0) / warp.dur); if (k >= 1) warp = null; else { amt = Math.sin(Math.PI * Math.min(1, k)) ** 0.8; dir = warp.dir; } }

    if (cur.stars > 0.02) {
      for (const s of stars) {
        if (dt) {
          s.y -= (dt / 1000) * 0.005 * s.z; if (s.y < -0.02) { s.y = 1.02; s.x = Math.random(); }
          const bx = s.x * width + px * s.z + s.ox, by = s.y * height + py * s.z + s.oy;
          const dx = bx - mx, dy = by - my, d2 = dx * dx + dy * dy;
          if (pointer.glow > 0.05 && d2 < 16900 && d2 > 1) { const d = Math.sqrt(d2), f = (1 - d / 130) * 0.9 * ds; s.vx += (dx / d) * f; s.vy += (dy / d) * f; }
          if (pointer.down && d2 < 67600 && d2 > 1) { const d = Math.sqrt(d2); s.vx -= (dx / d) * 0.32 * ds; s.vy -= (dy / d) * 0.32 * ds; }
          s.vx -= s.ox * 0.02 * ds; s.vy -= s.oy * 0.02 * ds;
          const damp = Math.pow(0.92, ds); s.vx *= damp; s.vy *= damp; s.ox += s.vx * ds; s.oy += s.vy * ds;
        }
        const a = Math.min(1, s.z * (0.62 + 0.38 * Math.sin(now * 0.0011 * s.tw + s.phase)) * cur.stars * 1.15);
        if (a < 0.03) continue;
        const x = s.x * width + px * s.z + s.ox, y = s.y * height + py * s.z + s.oy;
        const col = `rgba(${s.c[0]},${s.c[1]},${s.c[2]},${a.toFixed(3)})`;
        if (amt > 0.04) { ctx.strokeStyle = col; ctx.lineWidth = s.r; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + dir * (42 * amt * s.z + 4)); ctx.stroke(); }
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, s.r, 0, 6.283); ctx.fill();
        if (s.r > 1.35) { ctx.fillStyle = `rgba(${s.c[0]},${s.c[1]},${s.c[2]},${(a * 0.16).toFixed(3)})`; ctx.beginPath(); ctx.arc(x, y, s.r * 3.6, 0, 6.283); ctx.fill(); }
        if (pointer.glow > 0.05 && near.length < 16 && (x - mx) ** 2 + (y - my) ** 2 < 24000) near.push({ x, y });
      }
      if (near.length > 1) {
        ctx.lineWidth = 0.9;
        for (let i = 0; i < near.length; i++) for (let k = i + 1; k < near.length; k++) {
          const d = Math.hypot(near[i].x - near[k].x, near[i].y - near[k].y);
          if (d < 105) { ctx.strokeStyle = `rgba(165,228,240,${(0.3 * (1 - d / 105) * pointer.glow * Math.max(cur.stars, 0.3)).toFixed(3)})`; ctx.beginPath(); ctx.moveTo(near[i].x, near[i].y); ctx.lineTo(near[k].x, near[k].y); ctx.stroke(); }
        }
      }
    }

    if (cur.rain > 0.02) {
      const wind = 0.18 + (pointer.x - 0.5) * 0.6;
      ctx.lineWidth = 1.1;
      for (const d of drops) {
        if (dt) { d.y += (dt / 1000) * 0.6 * d.z; d.x += (dt / 1000) * wind * 0.12 * d.z; if (d.y > 1.05) { d.y = -0.05; d.x = Math.random(); } if (d.x > 1.05) d.x = -0.05; }
        const x = d.x * width, y = d.y * height;
        ctx.strokeStyle = `rgba(190,225,245,${(0.28 * d.z * cur.rain).toFixed(3)})`;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - wind * d.len, y + d.len); ctx.stroke();
      }
    }

    if (cur.pollen > 0.02) {
      for (const m of motes) {
        if (dt) {
          m.y -= (dt / 1000) * m.v; m.x += Math.sin(now * 0.0007 + m.phase) * 0.00012 * dt / 16;
          const dx = mx / width - m.x, dy = my / height - m.y, dist = Math.hypot(dx * width, dy * height);
          if (pointer.glow > 0.05 && dist < 240 && dist > 4) { m.x += (dx / dist) * 0.0002 * dt * pointer.glow; m.y += (dy / dist) * 0.0002 * dt * pointer.glow; }
          if (m.y < -0.03) { m.y = 1.03; m.x = Math.random(); }
        }
        const x = m.x * width, y = m.y * height, tw = 0.55 + 0.45 * Math.sin(now * 0.0015 + m.phase);
        ctx.fillStyle = `rgba(150,240,205,${(0.13 * cur.pollen * tw).toFixed(3)})`; ctx.beginPath(); ctx.arc(x, y, m.r * 4, 0, 6.283); ctx.fill();
        ctx.fillStyle = `rgba(190,255,225,${(0.7 * cur.pollen * tw).toFixed(3)})`; ctx.beginPath(); ctx.arc(x, y, m.r, 0, 6.283); ctx.fill();
      }
    }

    // wind streaks while changing tab: rush past in the direction of travel
    if (amt > 0.03) {
      const k = Math.max(0, (now - (warp?.t0 ?? now)) / (warp?.dur || 1));
      ctx.lineWidth = 1.2;
      for (const s of streaks) {
        const y = (((s.y0 - dir * (Number.isFinite(k) ? k : 0) * 1.9 * s.z) % 1) + 1) % 1 * height, x = s.x * width + px * s.z;
        const len = (30 + 100 * s.z) * amt;
        const g = ctx.createLinearGradient(x, y, x, y + dir * len);
        g.addColorStop(0, `rgba(215,235,255,${(0.26 * amt * s.z).toFixed(3)})`); g.addColorStop(1, "rgba(215,235,255,0)");
        ctx.strokeStyle = g; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + dir * len); ctx.stroke();
      }
    }

    // pointer trail
    for (let i = trail.length - 1; i >= 0; i--) {
      const t = trail[i], k = Math.max(0, (now - t.t0) / 650);
      if (k >= 1) { trail.splice(i, 1); continue; }
      t.x += t.vx * ds; t.y += t.vy * ds;
      ctx.fillStyle = `rgba(${t.c[0]},${t.c[1]},${t.c[2]},${(0.55 * (1 - k)).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(t.x, t.y, 1.6 * (1 - k * 0.6), 0, 6.283); ctx.fill();
    }
    // click: sparks and rings
    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i], k = Math.max(0, (now - p.t0) / p.life);
      if (k >= 1) { sparks.splice(i, 1); continue; }
      p.x += p.vx * ds; p.y += p.vy * ds; p.vx *= Math.pow(0.95, ds); p.vy *= Math.pow(0.95, ds);
      ctx.fillStyle = `rgba(${p.c[0]},${p.c[1]},${p.c[2]},${(0.8 * (1 - k)).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, 1.8 * (1 - k * 0.5), 0, 6.283); ctx.fill();
    }
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i], k = Math.max(0, (now - r.t0) / 900);
      if (k >= 1) { ripples.splice(i, 1); continue; }
      const e = 1 - (1 - k) ** 3;
      ctx.lineWidth = 1.6 * (1 - k) + 0.4;
      ctx.strokeStyle = `rgba(150,225,240,${(0.45 * (1 - k)).toFixed(3)})`; ctx.beginPath(); ctx.arc(r.x, r.y, 190 * e, 0, 6.283); ctx.stroke();
      ctx.strokeStyle = `rgba(190,170,255,${(0.28 * (1 - k)).toFixed(3)})`; ctx.beginPath(); ctx.arc(r.x, r.y, 120 * e, 0, 6.283); ctx.stroke();
    }

    if (pointer.glow > 0.01) {
      const g = ctx.createRadialGradient(mx, my, 0, mx, my, 250);
      g.addColorStop(0, `rgba(130,215,235,${(0.13 * pointer.glow).toFixed(3)})`);
      g.addColorStop(1, "rgba(130,215,235,0)");
      ctx.fillStyle = g; ctx.fillRect(mx - 250, my - 250, 500, 500);
    }

    if (meteor) {
      const k = Math.max(0, (now - meteor.t0) / meteor.life);
      if (k >= 1) meteor = null;
      else {
        const x = meteor.x + meteor.dx * k, y = meteor.y + meteor.dy * k, fade = Math.sin(k * Math.PI);
        const g = ctx.createLinearGradient(x, y, x - meteor.dx * 0.22, y - meteor.dy * 0.22);
        g.addColorStop(0, `rgba(235,242,250,${(0.85 * fade).toFixed(3)})`); g.addColorStop(1, "rgba(235,242,250,0)");
        ctx.strokeStyle = g; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - meteor.dx * 0.22, y - meteor.dy * 0.22); ctx.stroke();
      }
    }
  }

  function tick(now) {
    frame = requestAnimationFrame(tick);
    if (!awake && !warp) { cancelAnimationFrame(frame); frame = 0; Object.assign(cur, target); pointer.glow = 0; ripples = []; sparks = []; trail = []; paint(now, 0); return; }
    if (now - last < 33) return;
    const dt = Math.min(now - last, 100); last = now;
    pointer.x += (pointer.tx - pointer.x) * 0.08; pointer.y += (pointer.ty - pointer.y) * 0.08;
    pointer.glow += (pointer.glowTarget - pointer.glow) * 0.08;
    lerpScene(0.045);
    // parallax of the cloud / aurora / ground layers follows the pointer
    const vars = `${(pointer.x - 0.5).toFixed(3)},${(pointer.y - 0.5).toFixed(3)}`;
    if (vars !== lastVars && skyEl) { lastVars = vars; skyEl.style.setProperty("--mx", (pointer.x - 0.5).toFixed(3)); skyEl.style.setProperty("--my", (pointer.y - 0.5).toFixed(3)); }
    if (!meteor && target.meteor > 0 && now > nextMeteor) {
      meteor = { x: Math.random() * width * 0.75, y: Math.random() * height * 0.4, dx: 380 + Math.random() * 200, dy: 170 + Math.random() * 110, t0: now, life: 1200 };
      nextMeteor = now + (3000 + Math.random() * 4000) / target.meteor;
    }
    paint(now, dt);
  }

  function start() { if (!frame) { last = 0; frame = requestAnimationFrame(tick); } }
  function stop() { if (frame) cancelAnimationFrame(frame); frame = 0; }

  window.addEventListener("pointermove", (event) => {
    pointer.tx = event.clientX / width; pointer.ty = event.clientY / height; pointer.glowTarget = 1;
    const now = performance.now();
    if (awake && now - pointer.trailAt > 28 && Math.hypot(event.clientX - pointer.px, event.clientY - pointer.py) > 7 && trail.length < 40) {
      pointer.trailAt = now; trail.push({ x: event.clientX, y: event.clientY, vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4 + 0.15, t0: now, c: sparkColor() });
    }
    pointer.px = event.clientX; pointer.py = event.clientY;
  }, { passive: true });
  window.addEventListener("pointerdown", (event) => { if (!awake || event.button > 0) return; pointer.down = true; burst(event.clientX, event.clientY, 1); }, { passive: true });
  window.addEventListener("pointerup", (event) => { if (!pointer.down) return; pointer.down = false; if (awake) burst(event.clientX, event.clientY, 0.45); }, { passive: true });
  window.addEventListener("pointercancel", () => { pointer.down = false; });
  document.addEventListener("pointerleave", () => { pointer.glowTarget = 0; });
  document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); else start(); });
  let resizeTimer = 0;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 150); });
  resize();
  return {
    setView(index, allowed, dir) {
      target = SKY_SCENES[index] || SKY_SCENES[0];
      awake = allowed;
      if (dir) warp = { t0: performance.now(), dur: 1500, dir };
      if (allowed) { skyEl?.classList.remove("is-still"); }
      else window.setTimeout(() => { if (!awake) skyEl?.classList.add("is-still"); }, 1700);
      start();
    },
  };
})();

// Hero: the globe and its orbit lean slightly with the pointer.
const heroGrid = $("#heroGrid");
heroGrid?.addEventListener("pointermove", (event) => {
  const rect = heroGrid.getBoundingClientRect();
  const x = (event.clientX - rect.left) / Math.max(rect.width, 1) - 0.5;
  const y = (event.clientY - rect.top) / Math.max(rect.height, 1) - 0.5;
  heroGrid.style.setProperty("--globe-offset-x", `${(-x * 9).toFixed(2)}px`);
  heroGrid.style.setProperty("--globe-offset-y", `${(-y * 7).toFixed(2)}px`);
});
heroGrid?.addEventListener("pointerleave", () => {
  heroGrid.style.setProperty("--globe-offset-x", "0px");
  heroGrid.style.setProperty("--globe-offset-y", "0px");
});
$$(".section-heading, .feature-card, .study-card, .team-card, .intro-step-list, .hydro-card, .hydro-copy, .variable-cards > *").forEach((el) => el.classList.add("reveal-item"));

// ---------------------------------------------------------------------------
// TABS — each section is its own page. Changing tab moves the sky one step down (or
// back up): the background gradient slides, the stars fade and a haze of atmosphere
// rises, so it feels like descending from orbit to the ground without any scrolling.
// Only transform and opacity are animated, so the cost is close to zero.
// ---------------------------------------------------------------------------
const VIEWS = [
  { id: "observatory", label: "Observatory", alt: "408 km", layer: "LOW EARTH ORBIT" },
  { id: "introduction", label: "How it works", alt: "120 km", layer: "THERMOSPHERE" },
  { id: "discover", label: "Data detective", alt: "45 km", layer: "MESOSPHERE" },
  { id: "explorer", label: "Earth Explorer", alt: "12 km", layer: "STRATOSPHERE" },
  { id: "hydrology", label: "Hydrology", alt: "1.5 km", layer: "TROPOSPHERE" },
  { id: "team", label: "Team", alt: "0 m", layer: "SURFACE" },
];
let currentViewId = null;
let viewToken = 0;
const viewIndex = (id) => VIEWS.findIndex((view) => view.id === id);

const footerEl = document.querySelector("footer");
if (footerEl && "IntersectionObserver" in window) new IntersectionObserver(([entry]) => $("#altimeter")?.classList.toggle("is-hidden", entry.isIntersecting), { threshold: 0.2 }).observe(footerEl);
const ALT_METERS = [408000, 120000, 45000, 12000, 1500, 0];
let altShown = ALT_METERS[0];
let altRaf = 0;
const formatAltitude = (m) => (m >= 10000 ? `${Math.round(m / 1000)} km` : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.max(0, Math.round(m))} m`);
function tweenAltitude(to) {
  const out = $("#altValue");
  if (!out) return;
  cancelAnimationFrame(altRaf);
  const from = altShown, t0 = performance.now(), dur = 1500;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur), e = 1 - (1 - k) ** 3;
    altShown = Math.exp(Math.log(from + 1) + (Math.log(to + 1) - Math.log(from + 1)) * e) - 1;
    out.textContent = formatAltitude(k >= 1 ? to : altShown);
    if (k < 1) altRaf = requestAnimationFrame(step);
  };
  altRaf = requestAnimationFrame(step);
}
(() => { const dots = $("#altDots"); if (dots) dots.innerHTML = VIEWS.map(() => "<i></i>").join(""); })();

function playDescent(direction) {
  const sky = $("#sky");
  if (!sky) return;
  sky.dataset.dir = direction;
  sky.classList.remove("is-falling");
  void sky.offsetWidth;
  sky.classList.add("is-falling");
  window.setTimeout(() => sky.classList.remove("is-falling"), 1600);
}

function paintSky(index) {
  const p = index / (VIEWS.length - 1);
  const sky = $("#sky");
  sky?.style.setProperty("--vp", p.toFixed(4));
  const scene = SKY_SCENES[index];
  sky?.style.setProperty("--haze", scene.haze);
  sky?.style.setProperty("--clouds", scene.clouds);
  sky?.style.setProperty("--limb", scene.limb);
  sky?.style.setProperty("--ground", scene.ground);
  sky?.style.setProperty("--aurora", scene.aurora);
  $("#scrollProgress")?.style.setProperty("--p", ((index + 1) / VIEWS.length).toFixed(4));
  $("#altimeter")?.style.setProperty("--alt-p", p.toFixed(4));
  if ($("#altLayer")) $("#altLayer").textContent = VIEWS[index].layer;
  tweenAltitude(ALT_METERS[index]);
  $$("#altDots i").forEach((dot, i) => { dot.classList.toggle("on", i === index); dot.classList.toggle("past", i < index); });
  const prev = VIEWS[index - 1], next = VIEWS[index + 1];
  const prevBtn = $("#viewPrev"), nextBtn = $("#viewNext");
  if (prevBtn) { prevBtn.hidden = !prev; if (prev) { prevBtn.title = `Previous: ${prev.label}`; prevBtn.setAttribute("aria-label", prevBtn.title); } }
  if (nextBtn) { nextBtn.hidden = !next; if (next) { nextBtn.title = `Next: ${next.label}`; nextBtn.setAttribute("aria-label", nextBtn.title); } }
}

const VIEW_ALIASES = { theatre: { view: "discover", anchor: "guidedStudies" }, studies: { view: "discover", anchor: "guidedStudies" } };
function scrollToAnchor(anchorId) {
  window.setTimeout(() => document.getElementById(anchorId)?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
}
function showView(requested, { push = true, focus = true } = {}) {
  const alias = VIEW_ALIASES[requested];
  const id = alias ? alias.view : requested;
  const anchor = alias?.anchor;
  const next = viewIndex(id) >= 0 ? id : "observatory";
  const nextEl = document.getElementById(next);
  if (!nextEl) return;
  if (next === currentViewId) { if (anchor) scrollToAnchor(anchor); else if (focus) nextEl.focus({ preventScroll: true }); return; }
  const prevId = currentViewId;
  const prevEl = prevId ? document.getElementById(prevId) : null;
  const direction = prevId && viewIndex(next) < viewIndex(prevId) ? "up" : "down";
  const token = ++viewToken;
  currentViewId = next;
  state.activeView = next === "observatory" ? "home" : next;

  $$(".nav-link").forEach((link) => {
    const on = link.getAttribute("href") === `#${next}`;
    link.classList.toggle("active", on);
    if (on) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
  });
  window.requestAnimationFrame(moveNavIndicator);
  paintSky(viewIndex(next));
  if (prevId) playDescent(direction);
  skyFx?.setView(viewIndex(next), next !== "explorer", prevId ? (direction === "down" ? 1 : -1) : 0);
  setMenu(false);
  document.title = next === "observatory" ? "EarthTrace — The Earth-System Signal Observatory" : `${VIEWS[viewIndex(next)].label} · EarthTrace`;
  if (push && location.hash !== `#${next}`) history.pushState({ view: next }, "", `#${next}`);

  const reveal = () => {
    if (token !== viewToken) return;
    VIEWS.forEach((view) => {
      const el = document.getElementById(view.id);
      if (el && el !== nextEl) { el.hidden = true; el.classList.remove("is-leaving", "leave-down", "leave-up", "is-entering-down", "is-entering-up"); }
    });
    nextEl.hidden = false;
    nextEl.classList.remove("is-leaving", "leave-down", "leave-up", "is-entering-down", "is-entering-up");
    if (prevId) { void nextEl.offsetWidth; nextEl.classList.add(direction === "down" ? "is-entering-down" : "is-entering-up"); }
    nextEl.querySelectorAll(".reveal-item").forEach((el, i) => el.style.setProperty("--i", Math.min(i, 9)));
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    if (anchor) scrollToAnchor(anchor);
    if (next === "explorer") { initializeGlobe(); window.setTimeout(resizeGlobe, 90); }
    if (focus) nextEl.focus({ preventScroll: true });
  };
  if (prevEl) { prevEl.classList.add("is-leaving", direction === "down" ? "leave-down" : "leave-up"); window.setTimeout(reveal, 230); }
  else reveal();
}

// Previous / next buttons at the bottom of the content tabs.
VIEWS.forEach((view, index) => {
  if (view.id === "observatory") return;
  const el = document.getElementById(view.id);
  if (!el) return;
  const prev = VIEWS[index - 1];
  const nxt = VIEWS[index + 1];
  const nav = document.createElement("nav");
  nav.className = "view-pager";
  nav.setAttribute("aria-label", "Continue through EarthTrace");
  nav.innerHTML = (prev ? `<button class="pager-btn" type="button" data-goto="${prev.id}"><small>← PREVIOUS</small><span>${esc(prev.label)}</span></button>` : "")
    + (nxt ? `<button class="pager-btn next" type="button" data-goto="${nxt.id}"><small>NEXT →</small><span>${esc(nxt.label)}</span></button>` : "");
  el.appendChild(nav);
});

$$("[data-jump]").forEach((button) => button.addEventListener("click", () => {
  document.getElementById(button.dataset.jump)?.scrollIntoView({ behavior: "smooth", block: "start" });
}));
if ("IntersectionObserver" in window) {
  const seen = new Map();
  const spy = new IntersectionObserver((entries) => {
    entries.forEach((entry) => seen.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0));
    let best = null, bestValue = 0;
    seen.forEach((value, key) => { if (value > bestValue) { bestValue = value; best = key; } });
    if (best) $$("[data-jump]").forEach((button) => button.classList.toggle("is-active", button.dataset.jump === best));
  }, { rootMargin: "-130px 0px -45% 0px", threshold: [0, 0.2, 0.5, 1] });
  ["discoverStart", "signalCatalogue", "guidedStudies"].forEach((id) => { const el = document.getElementById(id); if (el) spy.observe(el); });
}

document.addEventListener("click", (event) => {
  const goto = event.target.closest?.("[data-goto]");
  if (goto) { event.preventDefault(); showView(goto.dataset.goto); return; }
  const link = event.target.closest?.('a[href^="#"]');
  if (link && viewIndex(link.getAttribute("href").slice(1)) >= 0) { event.preventDefault(); showView(link.getAttribute("href").slice(1)); }
});
function stepView(offset) {
  const target = VIEWS[viewIndex(currentViewId) + offset];
  if (target) showView(target.id);
}
$("#viewPrev")?.addEventListener("click", () => stepView(-1));
$("#viewNext")?.addEventListener("click", () => stepView(1));
document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
  if (event.target.closest?.('input, textarea, select, [contenteditable], [role="tablist"]')) return;
  if (document.querySelector(".modal-backdrop:not([hidden])") || currentViewId === "explorer") return;
  stepView(event.key === "ArrowRight" ? 1 : -1);
});
window.addEventListener("popstate", () => showView(location.hash.slice(1), { push: false, focus: false }));
window.addEventListener("hashchange", () => showView(location.hash.slice(1), { push: false, focus: false }));

showView(location.hash.slice(1), { push: false, focus: false });
