const DATA = {
  erlaubnis: "data/geojson/rhein_erlaubnis_352_438.geojson",
  stationierung: "data/geojson/rhein_stationierung_352_438.geojson",
  rheinkm: "data/geojson/rheinkilometer_352_439.geojson",
  buhnen: "data/geojson/buhnen_osm_352_438.geojson",
  bootsslippen: "data/geojson/bootsslippen_osm_352_438.geojson",
  parkplaetze: "data/geojson/parkplaetze_osm_352_438.geojson",
  sperrstrecken: "data/geojson/erlaubnis_sperrstrecken_2026.geojson",
  schutz: "data/geojson/schutzgebiete_korridor_352_438.geojson",
  militaer: "data/geojson/osm_militaer_korridor_352_438.geojson",
};

const CONFIG = {
  species: "config/fischarten_profile.csv",
  factors: "config/fangprognose_faktoren.csv",
};

const state = {
  geo: {},
  species: {},
  factors: [],
  overlays: {},
  marker: null,
  recommendationLayer: null,
  savedSpotLayer: null,
  currentSpot: null,
  panelCollapsed: false,
  theme: "system",
  mapBrightness: 100,
};

const map = L.map("map", {
  zoomControl: true,
}).setView([49.42, 8.50], 12);

const rlpDop20Layer = (transparent = false) => L.tileLayer.wms("https://geo4.service24.rlp.de/wms/rp_dop20.fcgi?", {
  layers: "rp_dop20",
  format: "image/png",
  transparent,
  attribution: "© GeoBasis-DE / LVermGeoRP",
});

const bwDop20Layer = (transparent = false) => L.tileLayer.wms("https://owsproxy.lgl-bw.de/owsproxy/ows/WMS_INSP_BW_Orthofoto_DOP20?", {
  layers: "OI.OrthoimageCoverage",
  styles: "OI.OrthoimageCoverage.Default",
  format: "image/png",
  transparent,
  attribution: "© LGL Baden-Württemberg",
});

const baseLayers = {
  "OpenStreetMap": L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap",
  }),
  "TopPlusOpen": L.tileLayer.wms("https://sgx.geodatenzentrum.de/wms_topplus_open?", {
    layers: "web_light",
    format: "image/png",
    transparent: false,
    attribution: "© BKG TopPlusOpen",
  }),
  "Luftbild RLP + BW DOP20": L.layerGroup([rlpDop20Layer(true), bwDop20Layer(true)]),
  "RLP Luftbild DOP20": rlpDop20Layer(),
  "BW Luftbild DOP20": bwDop20Layer(),
};

baseLayers.TopPlusOpen.addTo(map);
L.control.layers(baseLayers, {}, { collapsed: true }).addTo(map);

const styles = {
  erlaubnis: { color: "#1d8b57", weight: 5, opacity: 0.9 },
  stationierung: { radius: 2, color: "#7b5d32", fillColor: "#e6c06c", fillOpacity: 0.85, weight: 1 },
  rheinkm: { radius: 5, color: "#392718", fillColor: "#f0c36d", fillOpacity: 0.9, weight: 1 },
  buhnen: { color: "#2a2a2a", weight: 2, opacity: 0.8 },
  sperrstrecken: { color: "#d62246", weight: 4, opacity: 0.9 },
  schutz: { color: "#338a4b", fillColor: "#55b96b", fillOpacity: 0.15, weight: 1 },
  militaer: { color: "#8e3a8b", fillColor: "#a85aa4", fillOpacity: 0.18, weight: 1 },
  bootsslippen: { color: "#0f5e9c", fillColor: "#ffffff", fillOpacity: 1, weight: 2 },
  parkplaetze: { color: "#0f5e9c", fillColor: "#ffffff", fillOpacity: 1, weight: 2 },
};

const layerLabels = {
  erlaubnis: "Erlaubnis",
  buhnen: "Buhnen",
  bootsslippen: "Bootsslippen",
  parkplaetze: "Parkplätze",
  sperrstrecken: "Sperrstrecken",
  schutz: "Schutzgebiete",
  militaer: "Militär/Warnkulisse",
  rheinkm: "Rheinkilometer",
  stationierung: "Stationierung",
};

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines.shift().split(";");
  return lines.filter(Boolean).map((line) => {
    const cols = line.split(";");
    return Object.fromEntries(headers.map((h, i) => [h, cols[i] ?? ""]));
  });
}

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Kann ${path} nicht laden`);
  return response.json();
}

async function loadText(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Kann ${path} nicht laden`);
  return response.text();
}

function makeLayer(key, geojson) {
  return L.geoJSON(geojson, {
    style: styles[key],
    pointToLayer: (feature, latlng) => {
      if (key === "bootsslippen") return L.marker(latlng, { icon: accessIcon("boat"), title: feature.properties?.name || "Bootsslip" });
      if (key === "parkplaetze") return L.marker(latlng, { icon: accessIcon("parking"), title: feature.properties?.name || "Parkplatz" });
      return L.circleMarker(latlng, styles[key]);
    },
    onEachFeature: (feature, layer) => {
      const props = feature.properties || {};
      const title = props.bezeichnung || props.bereich || props.name || props.station_km || props.KM1 || key;
      if (key === "bootsslippen" || key === "parkplaetze") {
        const kind = key === "bootsslippen" ? "Bootsslip" : "Parkplatz";
        const cost = props.kosten || "unbekannt";
        const access = props.zugang || "unbekannt";
        const km = props.rhein_km_nahe ? `km ${formatNumber(props.rhein_km_nahe, 3)}` : "km unbekannt";
        const distance = Number.isFinite(Number(props.abstand_rhein_m)) ? `${Math.round(Number(props.abstand_rhein_m))} m zur Rheinlinie` : "Abstand unbekannt";
        const note = props.hinweis || "Vor Ort prüfen.";
        layer.bindPopup(`
          <strong>${escapeHtml(kind)}: ${escapeHtml(title)}</strong><br>
          <b>Kosten:</b> ${escapeHtml(cost)}<br>
          <b>Zugang:</b> ${escapeHtml(access)}<br>
          <small>${escapeHtml(km)} · ${escapeHtml(distance)}</small><br>
          <small>${escapeHtml(note)}</small>
        `);
      } else {
        layer.bindPopup(`<strong>${title}</strong>`);
      }
    },
  });
}

function accessIcon(type) {
  const label = type === "boat" ? "⛵" : "P";
  const className = type === "boat" ? "access-marker access-marker-boat" : "access-marker access-marker-parking";
  return L.divIcon({
    className,
    html: `<span>${label}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

async function init() {
  configureNativeShell();
  restoreDisplaySettings();

  if (window.ANGELATLAS_BUNDLE) {
    state.geo = window.ANGELATLAS_BUNDLE.geo;
  } else {
    const entries = await Promise.all(Object.entries(DATA).map(async ([key, path]) => [key, await loadJson(path)]));
    state.geo = Object.fromEntries(entries);
  }

  const speciesCsv = window.ANGELATLAS_BUNDLE?.csv?.species ?? await loadText(CONFIG.species);
  const factorsCsv = window.ANGELATLAS_BUNDLE?.csv?.factors ?? await loadText(CONFIG.factors);
  state.species = Object.fromEntries(parseCsv(speciesCsv).map((row) => [row.art, row]));
  state.factors = parseCsv(factorsCsv);

  Object.keys(state.species).forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    if (name === "Zander") option.selected = true;
    document.querySelector("#speciesSelect").append(option);
  });

  for (const [key, geojson] of Object.entries(state.geo)) {
    state.overlays[key] = makeLayer(key, geojson);
  }

  state.overlays.erlaubnis.addTo(map);
  state.overlays.buhnen.addTo(map);
  state.overlays.bootsslippen.addTo(map);
  state.overlays.sperrstrecken.addTo(map);
  state.overlays.rheinkm.addTo(map);
  state.recommendationLayer = L.layerGroup().addTo(map);
  state.savedSpotLayer = L.layerGroup().addTo(map);
  renderSavedSpots();

  renderLayerToggles();
  renderCatchLog();
  map.on("click", (event) => inspectSpot(event.latlng));
  document.querySelector("#locateBtn").addEventListener("click", locateUser);
  document.querySelector("#panelToggleBtn").addEventListener("click", togglePanel);
  document.querySelector("#themeSelect").addEventListener("change", updateThemeFromInput);
  document.querySelector("#mapBrightnessInput").addEventListener("change", updateBrightnessFromInput);
  document.querySelector("#mapBrightnessInput").addEventListener("input", updateBrightnessFromInput);
  document.querySelector("#datetimeInput").value = localDatetimeValue(new Date());
  restorePanelState();
}

function configureNativeShell() {
  const statusBar = window.Capacitor?.Plugins?.StatusBar;
  if (!statusBar) return;
  statusBar.setOverlaysWebView?.({ overlay: false }).catch(() => {});
  statusBar.setBackgroundColor?.({ color: "#23331f" }).catch(() => {});
  statusBar.setStyle?.({ style: "LIGHT" }).catch(() => {});
}

function restoreDisplaySettings() {
  state.theme = localStorage.getItem("angelatlas_theme") || "system";
  state.mapBrightness = Number(localStorage.getItem("angelatlas_map_brightness") || 100);
  if (!Number.isFinite(state.mapBrightness)) state.mapBrightness = 100;
  state.mapBrightness = Math.max(55, Math.min(125, state.mapBrightness));
  document.body.dataset.theme = state.theme;
  document.documentElement.style.setProperty("--map-brightness", String(state.mapBrightness / 100));
}

function syncDisplayInputs() {
  const themeSelect = document.querySelector("#themeSelect");
  const brightnessInput = document.querySelector("#mapBrightnessInput");
  if (themeSelect) themeSelect.value = state.theme;
  if (brightnessInput) brightnessInput.value = String(state.mapBrightness);
}

function updateThemeFromInput() {
  const value = document.querySelector("#themeSelect").value;
  state.theme = ["system", "light", "dark"].includes(value) ? value : "system";
  localStorage.setItem("angelatlas_theme", state.theme);
  document.body.dataset.theme = state.theme;
}

function updateBrightnessFromInput() {
  const input = document.querySelector("#mapBrightnessInput");
  const value = Math.max(55, Math.min(125, Number(input.value) || 100));
  state.mapBrightness = value;
  input.value = String(value);
  localStorage.setItem("angelatlas_map_brightness", String(value));
  document.documentElement.style.setProperty("--map-brightness", String(value / 100));
}

function restorePanelState() {
  state.panelCollapsed = localStorage.getItem("angelatlas_panel_collapsed") === "1";
  applyPanelState();
  syncDisplayInputs();
}

function togglePanel() {
  state.panelCollapsed = !state.panelCollapsed;
  localStorage.setItem("angelatlas_panel_collapsed", state.panelCollapsed ? "1" : "0");
  applyPanelState();
  setTimeout(() => map.invalidateSize(), 210);
}

function applyPanelState() {
  const panel = document.querySelector("#panel");
  const button = document.querySelector("#panelToggleBtn");
  panel.classList.toggle("collapsed", state.panelCollapsed);
  button.textContent = state.panelCollapsed ? "Spot" : "Karte";
  button.setAttribute("aria-expanded", state.panelCollapsed ? "false" : "true");
}

function renderLayerToggles() {
  const root = document.querySelector("#layerToggles");
  for (const key of ["erlaubnis", "buhnen", "bootsslippen", "parkplaetze", "sperrstrecken", "schutz", "militaer", "rheinkm", "stationierung"]) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = map.hasLayer(state.overlays[key]);
    input.addEventListener("change", () => {
      if (input.checked) state.overlays[key].addTo(map);
      else map.removeLayer(state.overlays[key]);
    });
    label.append(input, document.createTextNode(layerLabels[key]));
    root.append(label);
  }
}

function localDatetimeValue(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function locateUser() {
  if (!navigator.geolocation) return alert("Standort ist auf diesem Gerät nicht verfügbar.");
  navigator.geolocation.getCurrentPosition((pos) => {
    const latlng = L.latLng(pos.coords.latitude, pos.coords.longitude);
    map.setView(latlng, 15);
    inspectSpot(latlng);
  }, () => alert("Standort konnte nicht ermittelt werden."));
}

function inspectSpot(latlng) {
  if (state.marker) state.marker.remove();
  state.marker = L.circleMarker(latlng, {
    radius: 7,
    color: "#0f3d2e",
    weight: 2,
    fillColor: "#f2c94c",
    fillOpacity: 1,
  }).addTo(map);

  const nearestStation = nearestFeature(latlng, state.geo.stationierung);
  const nearestPermission = nearestFeature(latlng, state.geo.erlaubnis);
  const nearestBuhne = nearestFeature(latlng, state.geo.buhnen);
  const nearestSperre = nearestFeature(latlng, state.geo.sperrstrecken);
  const schutzHits = containingFeatures(latlng, state.geo.schutz);
  const militaerHits = containingFeatures(latlng, state.geo.militaer);

  const riverKm = Number(nearestStation.feature?.properties?.station_km);
  const nearRiver = nearestStation.distanceM <= 650;
  const permissionByKm = findKmRange(riverKm, state.geo.erlaubnis, 0.015);
  const sperreByKm = findKmRange(riverKm, state.geo.sperrstrecken, 0.015);
  const erlaubnisOk = nearRiver && Boolean(permissionByKm) && nearestPermission.distanceM <= 650;
  const gesperrt = nearRiver && (Boolean(sperreByKm) || nearestSperre.distanceM <= 120);
  const warnkulisse = schutzHits.length > 0 || militaerHits.length > 0;
  const species = document.querySelector("#speciesSelect").value;
  const legalInfo = { riverKm, nearRiver, permissionByKm, sperreByKm, erlaubnisOk, gesperrt };
  const context = buildForecastContext({ nearestBuhne, legalInfo, warnkulisse });
  const forecast = evaluateForecast(context, species);
  const recommendations = buildSpotRecommendations(latlng);
  state.currentSpot = { latlng, nearestStation, nearestBuhne, legalInfo, forecast };

  renderResult({ latlng, nearestStation, nearestPermission, nearestBuhne, nearestSperre, schutzHits, militaerHits, forecast, legalInfo, recommendations });
  renderRecommendationMarkers(recommendations);
}

function buildForecastContext({ nearestBuhne, legalInfo, warnkulisse }) {
  const struktur = nearestBuhne.distanceM <= 250
    ? "buhne,kante,steinpackung"
    : nearestBuhne.distanceM <= 500 ? "uferstruktur" : "strukturarm";
  const erlaubnisstatus = legalInfo.gesperrt
    ? "gesperrt"
    : legalInfo.erlaubnisOk ? "erlaubt" : legalInfo.nearRiver ? "unklar" : "ausserhalb";
  return {
    erlaubnisstatus,
    sperrstrecke: legalInfo.gesperrt,
    warnkulisse,
    struktur,
    pegeltrend: "stabil",
    datetime: document.querySelector("#datetimeInput").value,
    wassertemperatur_c: Number(document.querySelector("#waterTempInput").value || 0),
    sichttiefe_m: Number(document.querySelector("#visibilityInput").value || 0),
    luftdruck_reihe_hpa: document.querySelector("#pressureSeriesInput").value,
    fangmeldungen: "keine",
  };
}

function evaluateForecast(rawContext, speciesName) {
  const context = expandContextForSpecies(enrichContext(rawContext), speciesName);
  const profile = state.species[speciesName];
  const factors = state.factors.filter((factor) => factor.art === speciesName && factor.gewicht !== "hart");
  let totalWeight = 0;
  let weighted = 0;
  const reasons = [];

  for (const factor of factors) {
    const weight = Number(factor.gewicht);
    const [part, reason] = factor.faktor === "wassertemperatur"
      ? temperatureScore(context.wassertemperatur_c, profile)
      : categoricalScore(context[factor.faktor], factor);
    totalWeight += weight;
    weighted += part * weight;
    reasons.push(reason);
  }

  let score = totalWeight ? Math.round((weighted / totalWeight) * 1000) / 10 : 0;
  const blocked = context.erlaubnisstatus === "gesperrt" || context.sperrstrecke;
  const warnings = [];
  if (context.warnkulisse) warnings.push("Warnkulisse im Umfeld: vor Ort und im Erlaubnisschein prüfen.");
  if (blocked) {
    score = 0;
    reasons.unshift("Rechtliche Vorprüfung: gesperrt oder außerhalb der Erlaubnis.");
  } else if (context.erlaubnisstatus !== "erlaubt") {
    score = Math.round(score * 75) / 100;
    reasons.unshift("Erlaubnisstatus nicht eindeutig: vorsichtig abgewertet.");
  }
  if (warnings.length && !blocked) score = Math.round(score * 85) / 100;
  if (!blocked) {
    const boost = catchReportBoost(context, speciesName);
    if (boost.points) {
      score = Math.min(100, Math.round((score + boost.points) * 10) / 10);
      reasons.unshift(boost.reason);
    }
  }

  return {
    species: speciesName,
    score,
    rating: rating(score, blocked),
    warnings,
    reasons: reasons.slice(0, 10),
    context,
  };
}

function catchReportBoost(context, speciesName) {
  const spot = context.latlng;
  if (!spot) return { points: 0, reason: "" };
  const dt = context.datetime ? new Date(context.datetime) : new Date();
  const targetHour = dt.getHours();
  const targetSeason = seasonForMonth(dt.getMonth() + 1);
  let matches = 0;
  let strong = 0;
  for (const entry of getAllCatchReports()) {
    if (String(entry.species || "").toLowerCase() !== String(speciesName).toLowerCase()) continue;
    if (!Number.isFinite(Number(entry.lat)) || !Number.isFinite(Number(entry.lng))) continue;
    const distance = haversine({ lat: spot.lat, lng: spot.lng }, { lat: Number(entry.lat), lng: Number(entry.lng) });
    if (distance > 3000) continue;
    const entryDate = entry.time ? new Date(entry.time) : null;
    if (!entryDate || Number.isNaN(entryDate.valueOf())) continue;
    const hourDiff = Math.min(Math.abs(entryDate.getHours() - targetHour), 24 - Math.abs(entryDate.getHours() - targetHour));
    const seasonMatch = seasonForMonth(entryDate.getMonth() + 1) === targetSeason;
    if (hourDiff <= 3 || seasonMatch) {
      matches += 1;
      if (distance <= 1200 && hourDiff <= 2) strong += 1;
    }
  }
  if (strong >= 3) return { points: 8, reason: `Fangdaten-Bonus: ${strong} starke passende ${speciesName}-Meldungen im Umfeld/Zeitfenster.` };
  if (strong >= 1) return { points: 5, reason: `Fangdaten-Bonus: passende ${speciesName}-Meldung nah am Spot/Zeitfenster.` };
  if (matches >= 3) return { points: 4, reason: `Fangdaten-Bonus: mehrere ähnliche ${speciesName}-Meldungen im 3-km-Umfeld.` };
  if (matches >= 1) return { points: 2, reason: `Fangdaten-Bonus: ähnliche ${speciesName}-Meldung im Umfeld.` };
  return { points: 0, reason: "" };
}

function getAllCatchReports() {
  return [...getCatchLog(), ...getImportedCatchReports()];
}

function getImportedCatchReports() {
  try {
    return JSON.parse(localStorage.getItem("angelatlas_import_fangmeldungen_v01") || "[]");
  } catch {
    return [];
  }
}

function importCatchReportsFromText() {
  const input = document.querySelector("#catchImportInput");
  const status = document.querySelector("#catchImportStatus");
  if (!input || !status) return;
  const rows = parseCatchImport(input.value);
  if (!rows.length) {
    status.textContent = "Keine gültigen Fangdaten erkannt.";
    return;
  }
  const existing = getImportedCatchReports();
  const merged = [...rows, ...existing].slice(0, 1000);
  localStorage.setItem("angelatlas_import_fangmeldungen_v01", JSON.stringify(merged));
  status.textContent = `${rows.length} Fangmeldung(en) importiert. Prognose nutzt sie ab dem nächsten Karten-Tipp.`;
  input.value = "";
}

function parseCatchImport(text) {
  return String(text || "").split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cols = line.includes(";") ? line.split(";") : line.split(",");
      const [species, time, lat, lng, size] = cols.map((value) => String(value || "").trim());
      const latNum = Number(String(lat).replace(",", "."));
      const lngNum = Number(String(lng).replace(",", "."));
      if (!species || !time || !Number.isFinite(latNum) || !Number.isFinite(lngNum)) return null;
      return {
        id: Date.now() + Math.round(Math.random() * 100000),
        species,
        time: normalizeImportDate(time),
        lat: Number(latNum.toFixed(7)),
        lng: Number(lngNum.toFixed(7)),
        size_cm: Number.isFinite(Number(size)) ? Number(size) : null,
        source: "import",
      };
    })
    .filter(Boolean);
}

function normalizeImportDate(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return text.slice(0, 16);
  const normalized = text.replace(" ", "T");
  const date = new Date(normalized);
  if (!Number.isNaN(date.valueOf())) return localDatetimeValue(date);
  const match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (match) {
    const [, d, m, y, h, min] = match;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:${min}`;
  }
  return localDatetimeValue(new Date());
}

function enrichContext(context) {
  const next = { ...context, derived: {} };
  const dt = context.datetime ? new Date(context.datetime) : null;
  if (dt && !Number.isNaN(dt.valueOf())) {
    next.jahreszeit = seasonForMonth(dt.getMonth() + 1);
    next.licht = lightPhase(dt);
    const moon = moonPhase(dt);
    next.mond = moon.phase;
    next.derived.mondalter_tage = moon.age;
  }
  next.truebung = turbidityFromVisibility(context.sichttiefe_m);
  const pressure = pressureAnalysis(context.luftdruck_reihe_hpa);
  Object.assign(next, pressure.values);
  Object.assign(next.derived, pressure.derived);
  return next;
}

function expandContextForSpecies(context, species) {
  const values = new Set(String(context.struktur || "").split(",").filter(Boolean));
  if (["buhne", "kante", "steinpackung"].some((v) => values.has(v))) {
    values.add("uferkante"); values.add("uferstruktur");
    if (["Zander", "Barsch"].includes(species)) { values.add("buhnenkopf"); values.add("kleinfisch"); }
    if (species === "Rapfen") { values.add("stroemung"); values.add("buhnenkopf"); values.add("oberflaeche"); }
    if (species === "Wels") { values.add("kehrwasser"); values.add("steinpackung"); }
    if (["Barbe", "Doebel"].includes(species)) { values.add("stroemung"); values.add("kante"); }
  }
  return { ...context, struktur: [...values].sort().join(",") };
}

function buildSpotRecommendations(originLatLng) {
  const candidates = candidateStationPoints(originLatLng, 2500);
  const results = [];
  for (const candidate of candidates) {
    const latlng = candidate.latlng;
    const nearestPermission = nearestFeature(latlng, state.geo.erlaubnis);
    const nearestBuhne = nearestFeature(latlng, state.geo.buhnen);
    const nearestSperre = nearestFeature(latlng, state.geo.sperrstrecken);
    const schutzHits = containingFeatures(latlng, state.geo.schutz);
    const militaerHits = containingFeatures(latlng, state.geo.militaer);
    const riverKm = Number(candidate.feature.properties.station_km);
    const permissionByKm = findKmRange(riverKm, state.geo.erlaubnis, 0.015);
    const sperreByKm = findKmRange(riverKm, state.geo.sperrstrecken, 0.015);
    const legalInfo = {
      riverKm,
      nearRiver: true,
      permissionByKm,
      sperreByKm,
      erlaubnisOk: Boolean(permissionByKm) && nearestPermission.distanceM <= 650,
      gesperrt: Boolean(sperreByKm) || nearestSperre.distanceM <= 120,
    };
    if (!legalInfo.erlaubnisOk || legalInfo.gesperrt) continue;
    const warnkulisse = schutzHits.length > 0 || militaerHits.length > 0;
    const baseContext = buildForecastContext({ nearestBuhne, legalInfo, warnkulisse });
    baseContext.latlng = latlng;
    const best = bestSpeciesForecastForNextTwoHours(baseContext);
    if (!best) continue;
    results.push({
      latlng,
      rhein_km: riverKm,
      distance_m: Math.round(candidate.distanceM),
      buhne_m: Math.round(nearestBuhne.distanceM),
      schutz_count: schutzHits.length,
      militaer_count: militaerHits.length,
      forecast: best,
    });
  }
  results.sort((a, b) => b.forecast.score - a.forecast.score || a.distance_m - b.distance_m);
  return diversifyRecommendations(results, 5, 280);
}

function candidateStationPoints(originLatLng, radiusM) {
  const candidates = [];
  const usedKm = new Set();
  for (const feature of state.geo.stationierung.features || []) {
    if (feature.geometry?.type !== "Point") continue;
    const [lng, lat] = feature.geometry.coordinates;
    const latlng = L.latLng(lat, lng);
    const distanceM = haversine(originLatLng, latlng);
    if (distanceM > radiusM) continue;
    const km = Number(feature.properties?.station_km);
    const bucket = Number.isFinite(km) ? Math.round(km * 5) / 5 : Math.round(distanceM / 250);
    if (usedKm.has(bucket)) continue;
    usedKm.add(bucket);
    candidates.push({ feature, latlng, distanceM });
  }
  candidates.sort((a, b) => a.distanceM - b.distanceM);
  return candidates.slice(0, 36);
}

function bestSpeciesForecastForNextTwoHours(baseContext) {
  const speciesNames = Object.keys(state.species);
  const baseDate = baseContext.datetime ? new Date(baseContext.datetime) : new Date();
  let best = null;
  for (const species of speciesNames) {
    const forecasts = [0, 1, 2].map((hours) => {
      const nextDate = new Date(baseDate.getTime() + hours * 60 * 60 * 1000);
      const context = { ...baseContext, datetime: localDatetimeValue(nextDate) };
      return evaluateForecast(context, species);
    });
    const average = Math.round((forecasts.reduce((sum, f) => sum + f.score, 0) / forecasts.length) * 10) / 10;
    const combined = {
      ...forecasts[0],
      score: average,
      rating: rating(average, forecasts[0].rating === "gesperrt"),
      reasons: [...new Set(forecasts.flatMap((f) => f.reasons))].slice(0, 5),
      warnings: [...new Set(forecasts.flatMap((f) => f.warnings))],
    };
    if (!best || combined.score > best.score) best = combined;
  }
  return best;
}

function diversifyRecommendations(results, limit, minDistanceM) {
  const selected = [];
  for (const item of results) {
    if (selected.every((existing) => haversine(item.latlng, existing.latlng) >= minDistanceM)) {
      selected.push(item);
      if (selected.length >= limit) break;
    }
  }
  return selected;
}

function temperatureScore(value, profile) {
  if (!value) return [0.5, "Wassertemperatur fehlt, neutral bewertet."];
  const temp = Number(value);
  const optMin = Number(profile.temperatur_opt_min_c);
  const optMax = Number(profile.temperatur_opt_max_c);
  const min = Number(profile.temperatur_min_c);
  const max = Number(profile.temperatur_max_c);
  if (temp >= optMin && temp <= optMax) return [1, `Wassertemperatur ${temp} °C liegt im Optimalfenster.`];
  if ((temp >= min && temp < optMin) || (temp > optMax && temp <= max)) return [0.55, `Wassertemperatur ${temp} °C ist brauchbar, aber nicht optimal.`];
  return [0.1, `Wassertemperatur ${temp} °C ist ungünstig.`];
}

function categoricalScore(value, factor) {
  if (value === undefined || value === null || value === "") return [0.5, `${factor.faktor}: kein Wert, neutral bewertet.`];
  const values = new Set(String(value).toLowerCase().split(",").map((v) => v.trim()).filter(Boolean));
  const favorable = splitFactor(factor.guenstig);
  const neutral = splitFactor(factor.neutral);
  const unfavorable = splitFactor(factor.unguenstig);
  if ([...values].some((v) => favorable.has(v))) return [1, `${factor.faktor}: günstig (${value}).`];
  if ([...values].some((v) => unfavorable.has(v))) return [0.1, `${factor.faktor}: ungünstig (${value}).`];
  if ([...values].some((v) => neutral.has(v))) return [0.55, `${factor.faktor}: neutral (${value}).`];
  return [0.45, `${factor.faktor}: unbekannter Wert (${value}), vorsichtig bewertet.`];
}

function splitFactor(text) {
  return new Set(String(text || "").toLowerCase().split(",").map((v) => v.trim()).filter(Boolean));
}

function rating(score, blocked) {
  if (blocked) return "gesperrt";
  if (score >= 80) return "sehr_gut";
  if (score >= 65) return "gut";
  if (score >= 45) return "mittel";
  return "schwach";
}

function seasonForMonth(month) {
  if ([3,4,5].includes(month)) return "fruehling";
  if ([6,7,8].includes(month)) return "sommer";
  if ([9,10,11].includes(month)) return "herbst";
  return "winter";
}

function lightPhase(date) {
  const hour = date.getHours() + date.getMinutes() / 60;
  const month = date.getMonth() + 1;
  let dawn = 6.5, day = 8.5, dusk = 16, night = 18;
  if ([5,6,7,8].includes(month)) [dawn, day, dusk, night] = [4.5, 6.5, 20, 22];
  else if ([3,4,9,10].includes(month)) [dawn, day, dusk, night] = [5.5, 7.5, 18, 20];
  if (hour >= dawn && hour < day) return "morgen";
  if (hour >= dusk && hour < night) return "daemmerung";
  if (hour >= night || hour < dawn) return "nacht";
  if (hour >= 11 && hour <= 15) return "mittag_grell";
  return "tag";
}

function moonPhase(date) {
  const known = new Date("2000-01-06T18:14:00");
  const synodic = 29.53058867;
  const days = (date - known) / 86400000;
  const age = ((days % synodic) + synodic) % synodic;
  let phase = "abnehmend";
  if (age < 1.8 || age > 27.7) phase = "neumond";
  else if (age >= 12.5 && age <= 16.8) phase = "vollmond_grell";
  else if ((age >= 6 && age <= 9.8) || (age >= 20 && age <= 23.8)) phase = "halbmond";
  else if (age < 14.8) phase = "zunehmend";
  return { phase, age: Math.round(age * 10) / 10 };
}

function turbidityFromVisibility(value) {
  const v = Number(value);
  if (!v) return "";
  if (v <= 0.3) return "hoch";
  if (v <= 0.8) return "mittel";
  if (v <= 1.5) return "niedrig";
  return "sehr_klar";
}

function pressureAnalysis(text) {
  const series = String(text || "").split(",").map((v) => Number(v.trim())).filter((v) => Number.isFinite(v));
  if (series.length < 2) return { values: {}, derived: {} };
  const diff = series[series.length - 1] - series[0];
  const span = Math.max(...series) - Math.min(...series);
  const trend = diff <= -5 ? "fallend" : diff <= -1.5 ? "leicht_fallend" : diff >= 5 ? "stark_steigend" : diff >= 1.5 ? "leicht_steigend" : "stabil";
  const stability = span <= 2 && Math.abs(diff) <= 1.5 ? "sehr_stabil" : span <= 4 && Math.abs(diff) <= 3 ? "stabil" : span <= 7 ? "leicht_schwankend" : "stark_schwankend";
  return {
    values: { luftdruck: trend, luftdruck_stabilitaet: stability },
    derived: {
      luftdruck: trend,
      luftdruck_aktuell_hpa: series[series.length - 1],
      luftdruck_diff_hpa: Math.round(diff * 10) / 10,
      luftdruck_spannweite_hpa: Math.round(span * 10) / 10,
      luftdruck_stabilitaet: stability,
    },
  };
}

function renderResult(data) {
  const { latlng, nearestStation, nearestPermission, nearestBuhne, nearestSperre, schutzHits, militaerHits, forecast, legalInfo, recommendations = [] } = data;
  const google = `https://www.google.com/maps/search/?api=1&query=${latlng.lat.toFixed(7)},${latlng.lng.toFixed(7)}`;
  const waze = `https://waze.com/ul?ll=${latlng.lat.toFixed(7)},${latlng.lng.toFixed(7)}&navigate=yes`;
  const result = document.querySelector("#result");
  const status = spotStatus(forecast.context.erlaubnisstatus, legalInfo);
  const permissionText = legalInfo.permissionByKm
    ? `${rangeName(legalInfo.permissionByKm)}<br><small>km ${formatRange(legalInfo.permissionByKm.properties)}</small>`
    : `${forecast.context.erlaubnisstatus}<br><small>${Math.round(nearestPermission.distanceM)} m zur Erlaubnislinie</small>`;
  const sperreText = legalInfo.sperreByKm
    ? `AKTIV: ${rangeName(legalInfo.sperreByKm)}<br><small>km ${formatRange(legalInfo.sperreByKm.properties)}</small>`
    : `keine aktive Sperre<br><small>nächste: ${nearestSperre.feature.properties.bereich || "-"} · ${Math.round(nearestSperre.distanceM)} m</small>`;
  const schutzText = schutzHits.length
    ? `Hinweis: ${schutzHits.length} Kulisse<br><small>Daten noch unvollständig, Regeln vor Ort prüfen</small>`
    : `kein Treffer<br><small>Datenabdeckung noch unvollständig</small>`;
  const militaerText = militaerHits.length
    ? `Warnkulisse: ${militaerHits.length}<br><small>vor Ort prüfen</small>`
    : "keine Treffer";
  const schutzDetails = protectionDetailsHtml(schutzHits);
  result.className = `result ${forecast.rating}`;
  result.innerHTML = `
    <div class="spot-status ${status.className}">${status.text}</div>
    <div class="score ${forecast.rating}">${forecast.species}: ${forecast.score}/100 · ${forecast.rating}</div>
    <div class="meta-grid">
      <div class="meta-card"><small>Rhein-km</small>${formatNumber(nearestStation.feature.properties.station_km, 3)}</div>
      <div class="meta-card"><small>Buhne</small>${Math.round(nearestBuhne.distanceM)} m</div>
      <div class="meta-card"><small>Erlaubnis</small>${permissionText}</div>
      <div class="meta-card"><small>Nächste Sperrstrecke</small>${sperreText}</div>
      <div class="meta-card"><small>Schutz</small>${schutzText}</div>
      <div class="meta-card"><small>Militär/Warn</small>${militaerText}</div>
    </div>
    ${schutzDetails}
    <details class="result-details">
      <summary>Abgeleitet</summary>
      <ul class="reason-list">
        ${Object.entries(forecast.context.derived || {}).map(([k, v]) => `<li>${k}: ${v}</li>`).join("")}
      </ul>
    </details>
    <details class="result-details">
      <summary>Begründung</summary>
      <ul class="reason-list">
        ${forecast.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}
      </ul>
    </details>
    ${forecast.warnings.map((w) => `<p class="legal-note">⚠️ ${escapeHtml(w)}</p>`).join("")}
    <div class="nav-links">
      <a href="${google}" target="_blank" rel="noopener">Google Maps</a>
      <a href="${waze}" target="_blank" rel="noopener">Waze</a>
    </div>
    ${recommendationsHtml(recommendations)}
    ${savedSpotControlsHtml()}
    ${catchImportHtml()}
    ${catchFormHtml(forecast.species)}
    <div id="catchSaveStatus" class="save-status" aria-live="polite"></div>
    <div id="catchLog" class="catch-log"></div>
  `;
  document.querySelector("#spotSaveBtn").addEventListener("click", saveCurrentSpot);
  document.querySelector("#catchImportBtn").addEventListener("click", importCatchReportsFromText);
  document.querySelector("#catchTimeInput").value = localDatetimeValue(new Date());
  document.querySelector("#catchSaveBtn").addEventListener("click", saveCatchReport);
  renderSavedSpotList();
  renderCatchLog();
}

function spotStatus(erlaubnisstatus, legalInfo) {
  if (erlaubnisstatus === "gesperrt" || legalInfo.sperreByKm) {
    return { className: "blocked", text: "Vorprüfung: gesperrt / nicht befischen" };
  }
  if (erlaubnisstatus === "erlaubt") {
    return { className: "allowed", text: "Vorprüfung: wahrscheinlich erlaubt" };
  }
  if (erlaubnisstatus === "ausserhalb") {
    return { className: "outside", text: "Vorprüfung: außerhalb der Rhein-Erlaubnis" };
  }
  return { className: "unknown", text: "Vorprüfung: unklar, vor Ort prüfen" };
}

function recommendationsHtml(recommendations) {
  if (!recommendations.length) {
    return `
      <section class="recommendation-box">
        <h3>Top-Spots im 2,5-km-Umkreis</h3>
        <p class="legal-note">Keine sicheren Vorschläge gefunden. Prüfe Standort, Erlaubnisstrecke und Sperrkulissen.</p>
      </section>
    `;
  }
  return `
    <section class="recommendation-box">
      <h3>Top-Spots nächste 2 h</h3>
      <p class="panel-mini">Beste 4–5 erlaubte Kandidaten im Umkreis von 2,5 km.</p>
      <div class="recommendation-list">
        ${recommendations.map((item, index) => {
          const google = `https://www.google.com/maps/search/?api=1&query=${item.latlng.lat.toFixed(7)},${item.latlng.lng.toFixed(7)}`;
          const score = Math.max(0, Math.min(100, Number(item.forecast.score) || 0));
          return `
            <article class="recommendation-card">
              <div class="recommendation-head">
                <strong>${index + 1}. ${escapeHtml(item.forecast.species)}</strong>
                <span>${formatNumber(score, 1)}/100</span>
              </div>
              <div class="recommendation-bar"><i style="width:${score}%"></i></div>
              <small>km ${formatNumber(item.rhein_km, 3)} · ${item.distance_m} m entfernt · Buhne ${item.buhne_m} m</small>
              <div class="recommendation-actions">
                <button type="button" data-rec-goto="${index}">zeigen</button>
                <a href="${google}" target="_blank" rel="noopener">Maps</a>
              </div>
            </article>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function renderRecommendationMarkers(recommendations) {
  if (!state.recommendationLayer) return;
  state.recommendationLayer.clearLayers();
  recommendations.forEach((item, index) => {
    const marker = L.marker(item.latlng, {
      icon: recommendationIcon(index + 1, item.forecast.rating),
      title: `${item.forecast.species} ${item.forecast.score}/100`,
    });
    marker.bindPopup(`
      <strong>${index + 1}. ${escapeHtml(item.forecast.species)} · ${formatNumber(item.forecast.score, 1)}/100</strong><br>
      km ${formatNumber(item.rhein_km, 3)} · ${item.distance_m} m entfernt<br>
      Buhne ${item.buhne_m} m
    `);
    marker.addTo(state.recommendationLayer);
  });
  setTimeout(() => {
    document.querySelectorAll("[data-rec-goto]").forEach((button) => {
      button.addEventListener("click", () => {
        const item = recommendations[Number(button.dataset.recGoto)];
        if (!item) return;
        map.setView(item.latlng, Math.max(map.getZoom(), 16));
        inspectSpot(item.latlng);
      });
    });
  }, 0);
}

function recommendationIcon(number, ratingName) {
  return L.divIcon({
    className: `recommendation-marker ${ratingName || ""}`,
    html: `<span>${number}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -15],
  });
}

function catchImportHtml() {
  return `
    <details class="catch-import">
      <summary>Fangdaten importieren</summary>
      <p class="panel-mini">CSV/Text je Zeile: Art;Datum/Zeit;Lat;Lng;Größe. Optional geht Komma statt Semikolon.</p>
      <textarea id="catchImportInput" rows="4" placeholder="Zander;2026-07-25 21:30;49.12345;8.12345;62"></textarea>
      <button id="catchImportBtn" class="secondary-button" type="button">Fangdaten übernehmen</button>
      <div id="catchImportStatus" class="save-status" aria-live="polite"></div>
    </details>
  `;
}

function catchFormHtml(species) {
  return `
    <section class="catch-box">
      <h3>Fangmeldung</h3>
      <div class="catch-grid">
        <label>Art
          <input id="catchSpeciesInput" value="${escapeHtml(species)}">
        </label>
        <label>Größe cm
          <input id="catchSizeInput" type="number" inputmode="decimal" min="0" step="1" placeholder="z.B. 62">
        </label>
        <label class="wide">Fangzeit
          <input id="catchTimeInput" type="datetime-local">
        </label>
      </div>
      <button id="catchSaveBtn" class="primary-button" type="button">Fang speichern</button>
    </section>
  `;
}

function savedSpotControlsHtml() {
  return `
    <section class="saved-spots-box">
      <div class="section-title-row">
        <h3>Meine Stellen</h3>
        <button id="spotSaveBtn" class="secondary-button" type="button">Stelle merken</button>
      </div>
      <div id="spotSaveStatus" class="save-status" aria-live="polite"></div>
      <div id="savedSpotList" class="saved-spot-list"></div>
    </section>
  `;
}

function saveCurrentSpot() {
  if (!state.currentSpot) return;
  const km = Number(formatNumber(state.currentSpot.nearestStation.feature.properties.station_km, 3));
  const defaultName = `Spot km ${formatNumber(km, 1)}`;
  const name = prompt("Name der Stelle", defaultName);
  if (name === null) return;
  const note = prompt("Notiz zur Stelle (optional)", "") ?? "";
  const entry = {
    id: Date.now(),
    name: name.trim() || defaultName,
    note: note.trim(),
    species: document.querySelector("#speciesSelect").value,
    lat: Number(state.currentSpot.latlng.lat.toFixed(7)),
    lng: Number(state.currentSpot.latlng.lng.toFixed(7)),
    rhein_km: km,
    buhne_m: Math.round(state.currentSpot.nearestBuhne.distanceM),
    status: state.currentSpot.forecast.context.erlaubnisstatus,
    score: state.currentSpot.forecast.score,
    saved_at: localDatetimeValue(new Date()),
  };
  const spots = getSavedSpots();
  spots.unshift(entry);
  localStorage.setItem("angelatlas_saved_spots_v01", JSON.stringify(spots.slice(0, 200)));
  const status = document.querySelector("#spotSaveStatus");
  if (status) status.textContent = "Stelle lokal gespeichert.";
  renderSavedSpots();
  renderSavedSpotList();
}

function getSavedSpots() {
  try {
    return JSON.parse(localStorage.getItem("angelatlas_saved_spots_v01") || "[]");
  } catch {
    return [];
  }
}

function renderSavedSpots() {
  if (!state.savedSpotLayer) return;
  state.savedSpotLayer.clearLayers();
  for (const spot of getSavedSpots()) {
    const latlng = L.latLng(spot.lat, spot.lng);
    const marker = L.marker(latlng, {
      icon: savedSpotIcon(),
      title: spot.name,
    });
    marker.bindPopup(`
      <strong>${escapeHtml(spot.name)}</strong><br>
      km ${formatNumber(spot.rhein_km, 3)} · ${escapeHtml(spot.species || "-")}<br>
      <small>${escapeHtml(spot.note || "keine Notiz")}</small>
    `);
    marker.on("click", () => {
      inspectSpot(latlng);
    });
    marker.addTo(state.savedSpotLayer);
  }
}

function savedSpotIcon() {
  return L.divIcon({
    className: "saved-spot-marker",
    html: '<span class="pin-head"></span><span class="pin-tip"></span>',
    iconSize: [28, 34],
    iconAnchor: [14, 32],
    popupAnchor: [0, -30],
  });
}

function renderSavedSpotList() {
  const root = document.querySelector("#savedSpotList");
  if (!root) return;
  const spots = getSavedSpots();
  if (!spots.length) {
    root.innerHTML = `<small>Noch keine gemerkten Stellen auf diesem Gerät.</small>`;
    return;
  }
  root.innerHTML = `
    <details>
      <summary>Gemerkte Stellen (${spots.length})</summary>
      <div class="saved-spot-items">
        ${spots.slice(0, 12).map((spot) => `
          <article class="saved-spot-item">
            <div>
              <strong>${escapeHtml(spot.name)}</strong>
              <small>km ${formatNumber(spot.rhein_km, 3)} · ${escapeHtml(spot.species || "-")} · Score ${formatNumber(spot.score, 1)}</small>
              ${spot.note ? `<small>${escapeHtml(spot.note)}</small>` : ""}
            </div>
            <div class="saved-spot-actions">
              <button type="button" data-spot-goto="${spot.id}">Zeigen</button>
              <button type="button" data-spot-delete="${spot.id}">Löschen</button>
            </div>
          </article>
        `).join("")}
      </div>
    </details>
  `;
  root.querySelectorAll("[data-spot-goto]").forEach((button) => {
    button.addEventListener("click", () => showSavedSpot(Number(button.dataset.spotGoto)));
  });
  root.querySelectorAll("[data-spot-delete]").forEach((button) => {
    button.addEventListener("click", () => deleteSavedSpot(Number(button.dataset.spotDelete)));
  });
}

function showSavedSpot(id) {
  const spot = getSavedSpots().find((entry) => entry.id === id);
  if (!spot) return;
  const latlng = L.latLng(spot.lat, spot.lng);
  map.setView(latlng, Math.max(map.getZoom(), 15));
  inspectSpot(latlng);
}

function deleteSavedSpot(id) {
  const spots = getSavedSpots();
  const spot = spots.find((entry) => entry.id === id);
  if (spot && !confirm(`Stelle "${spot.name}" löschen?`)) return;
  localStorage.setItem("angelatlas_saved_spots_v01", JSON.stringify(spots.filter((entry) => entry.id !== id)));
  renderSavedSpots();
  renderSavedSpotList();
}

function saveCatchReport() {
  if (!state.currentSpot) return;
  const species = document.querySelector("#catchSpeciesInput").value.trim() || document.querySelector("#speciesSelect").value;
  const sizeCm = Number(document.querySelector("#catchSizeInput").value);
  const time = document.querySelector("#catchTimeInput").value || localDatetimeValue(new Date());
  const entry = {
    id: Date.now(),
    species,
    size_cm: Number.isFinite(sizeCm) && sizeCm > 0 ? sizeCm : null,
    time,
    lat: Number(state.currentSpot.latlng.lat.toFixed(7)),
    lng: Number(state.currentSpot.latlng.lng.toFixed(7)),
    rhein_km: Number(formatNumber(state.currentSpot.nearestStation.feature.properties.station_km, 3)),
    buhne_m: Math.round(state.currentSpot.nearestBuhne.distanceM),
    status: state.currentSpot.forecast.context.erlaubnisstatus,
    score: state.currentSpot.forecast.score,
  };
  const log = getCatchLog();
  log.unshift(entry);
  localStorage.setItem("angelatlas_fangmeldungen_v04", JSON.stringify(log.slice(0, 50)));
  document.querySelector("#catchSaveStatus").textContent = "Fangmeldung lokal gespeichert.";
  document.querySelector("#catchSizeInput").value = "";
  renderCatchLog();
}

function getCatchLog() {
  try {
    return JSON.parse(localStorage.getItem("angelatlas_fangmeldungen_v04") || "[]");
  } catch {
    return [];
  }
}

function renderCatchLog() {
  const root = document.querySelector("#catchLog");
  if (!root) return;
  const all = getCatchLog();
  const log = all.slice(0, 5);
  if (!log.length) {
    root.innerHTML = `<small>Noch keine Fangmeldungen auf diesem Gerät.</small>`;
    return;
  }
  root.innerHTML = `
    <details>
      <summary>Gespeicherte Fänge (${all.length})</summary>
      <ul class="reason-list">
        ${log.map((entry) => `<li>${escapeHtml(entry.species)} ${entry.size_cm ? `${entry.size_cm} cm` : "ohne Größe"} · ${escapeHtml(entry.time)} · km ${formatNumber(entry.rhein_km, 3)}</li>`).join("")}
      </ul>
    </details>
  `;
}

function protectionDetailsHtml(hits) {
  if (!hits.length) {
    return `
      <p class="protection-note">
        Schutz-/Altrhein-Hinweis: kein Treffer im aktuellen Arbeitslayer. Das ist keine Freigabe-Garantie;
        Beschilderung, Erlaubnisschein und lokale Regeln bleiben maßgeblich.
      </p>
    `;
  }
  const rows = hits.slice(0, 5).map((feature) => {
    const props = feature.properties || {};
    const category = props.kategorie || "Schutzkulisse";
    const name = props.bezeichnung || props.name || props.kennung || "unbenannter Bereich";
    return `<li>${escapeHtml(category)}: ${escapeHtml(name)}</li>`;
  }).join("");
  const more = hits.length > 5 ? `<li>Weitere ${hits.length - 5} Treffer im Umfeld.</li>` : "";
  return `
    <details class="result-details protection-details">
      <summary>Schutz-/Altrhein-Hinweise (${hits.length})</summary>
      <p>Prüfkulisse, kein pauschales Angelverbot. Nicht alle Teilbereiche eines Altrheins sind automatisch gesperrt.</p>
      <ul class="reason-list">${rows}${more}</ul>
    </details>
  `;
}

function findKmRange(km, geojson, margin = 0) {
  if (!Number.isFinite(km)) return null;
  for (const feature of geojson.features || []) {
    const props = feature.properties || {};
    const from = Number(props.km_von);
    const to = Number(props.km_bis);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    const min = Math.min(from, to);
    const max = Math.max(from, to);
    if (km + margin >= min && km - margin <= max) return feature;
  }
  return null;
}

function rangeName(feature) {
  const props = feature?.properties || {};
  return escapeHtml(props.bereich || props.name || props.typ || props.status || "Bereich");
}

function formatRange(props = {}) {
  return `${formatNumber(props.km_von, 3)}-${formatNumber(props.km_bis, 3)}`;
}

function nearestFeature(latlng, geojson) {
  let best = { feature: null, distanceM: Infinity };
  for (const feature of geojson.features || []) {
    const d = distanceToGeometry(latlng, feature.geometry);
    if (d < best.distanceM) best = { feature, distanceM: d };
  }
  return best;
}

function containingFeatures(latlng, geojson) {
  return (geojson.features || []).filter((feature) => geometryContains(latlng, feature.geometry));
}

function distanceToGeometry(latlng, geom) {
  if (!geom) return Infinity;
  if (geom.type === "Point") return haversine(latlng, L.latLng(geom.coordinates[1], geom.coordinates[0]));
  if (geom.type === "LineString") return distanceToLine(latlng, geom.coordinates);
  if (geom.type === "MultiLineString") return Math.min(...geom.coordinates.map((line) => distanceToLine(latlng, line)));
  if (geom.type === "Polygon") return Math.min(...geom.coordinates.map((ring) => distanceToLine(latlng, ring)));
  if (geom.type === "MultiPolygon") return Math.min(...geom.coordinates.flat().map((ring) => distanceToLine(latlng, ring)));
  return Infinity;
}

function distanceToLine(latlng, coords) {
  let best = Infinity;
  for (let i = 1; i < coords.length; i++) {
    best = Math.min(best, distanceToSegmentMeters(latlng, coords[i - 1], coords[i]));
  }
  return best;
}

function distanceToSegmentMeters(latlng, a, b) {
  const lat0 = latlng.lat * Math.PI / 180;
  const project = ([lon, lat]) => ({
    x: lon * 111320 * Math.cos(lat0),
    y: lat * 110540,
  });
  const p = project([latlng.lng, latlng.lat]);
  const p1 = project(a);
  const p2 = project(b);
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - p1.x) * dx + (p.y - p1.y) * dy) / len2));
  const x = p1.x + t * dx;
  const y = p1.y + t * dy;
  return Math.hypot(p.x - x, p.y - y);
}

function geometryContains(latlng, geom) {
  if (!geom) return false;
  if (geom.type === "Polygon") return geom.coordinates.some((ring) => pointInRing(latlng, ring));
  if (geom.type === "MultiPolygon") return geom.coordinates.some((poly) => poly.some((ring) => pointInRing(latlng, ring)));
  return false;
}

function pointInRing(latlng, ring) {
  const x = latlng.lng;
  const y = latlng.lat;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function haversine(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat/2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon/2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function formatNumber(value, digits = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "-";
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
}

window.addEventListener("load", () => {
  init().catch((error) => {
    console.error(error);
    document.querySelector("#result").textContent = `Fehler beim Laden: ${error.message}`;
  });
  registerServiceWorker();
});

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const secureEnough = location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname);
  if (!secureEnough) return;
  navigator.serviceWorker.register("./sw.js").catch((error) => {
    console.warn("Service Worker konnte nicht registriert werden.", error);
  });
}
