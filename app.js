// Dashboard Pluto-AIS: lee data/ (generado por plutoais.publish).
// Pestaña "Mapa": trayectos de barcos en movimiento sobre satélite, con la potencia de cada trama.
// Pestaña "Estado": salud del PC de captura. Sin compilación: HTML + uPlot + Leaflet.
"use strict";

const $ = (s) => document.querySelector(s);
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of kids) e.append(k);
  return e;
};
const fmtInt = (n) => (n ?? 0).toLocaleString("es-ES");
const fmt1 = (v) => (v == null || Number.isNaN(v) ? "—" : (+v).toFixed(1));
const fmtTime = (t) => new Date(t * 1000).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
const fmtHM = (t) => new Date(t * 1000).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
const fmtHMS = (t) => new Date(t * 1000).toLocaleTimeString("es-ES");
const ago = (t) => {
  const m = Math.round((Date.now() / 1000 - t) / 60);
  return m < 1 ? "hace <1 min" : m < 90 ? `hace ${m} min` : `hace ${(m / 60).toFixed(1)} h`;
};
const ramp = () => cssVar("--ramp").split(",").map((s) => s.trim());
const rampColor = (p, lo, hi) => {
  const r = ramp();
  const k = hi > lo ? Math.round(((p - lo) / (hi - lo)) * (r.length - 1)) : r.length - 1;
  return r[Math.max(0, Math.min(r.length - 1, k))];
};
// Categorías de barco (tipo AIS) → color y etiqueta. Colores fijos (paleta categórica, mismo orden
// siempre); la identidad nunca va solo en el color: leyenda + nombre/tipo en el tooltip.
const CATS = [
  { k: "cargo", label: "Carga", color: "#2a78d6", re: /^Cargo/i },
  { k: "tanker", label: "Petrolero / tanque", color: "#eb6834", re: /^Tanker/i },
  { k: "pass", label: "Pasaje", color: "#1baf7a", re: /^Passenger|^High speed/i },
  { k: "fish", label: "Pesca", color: "#eda100", re: /^Fishing/i },
  { k: "leis", label: "Recreo / vela", color: "#e87ba4", re: /^Pleasure|^Sailing/i },
  { k: "serv", label: "Servicio portuario", color: "#008300",
    re: /^Tug|^Pilot|^Port Tender|^Anti-pollution|^Dredging|^Towing|^Medical|^Diving|^Engaged in diving/i },
  { k: "auth", label: "Autoridad / SAR", color: "#4a3aa7", re: /^Search and Rescue|^Military|^Law Enforcement/i },
  { k: "other", label: "Otro / desconocido", color: "#898781", re: /.*/ },
];
const catOf = (type) => CATS.find((c) => c.re.test(type || ""));
const kindOf = (cls) => (cls || "").startsWith("Estación") ? "base" : (cls || "").startsWith("Ayuda") ? "aton" : "ship";

// Icono SVG: casco orientado (en movimiento), círculo (parado), torre (estación base), rombo (AtoN)
function iconSVG(cat, kind, moving, rot, size = 22) {
  const s = `width="${size}" height="${size}" viewBox="-11 -11 22 22"`;
  if (kind === "base") return `<svg ${s}><path d="M0,-9 L6,8 L-6,8 Z M0,-9 L0,8" fill="#ffffff" stroke="#0b0b0b" stroke-width="1.5"/></svg>`;
  if (kind === "aton") return `<svg ${s}><path d="M0,-7 L7,0 L0,7 L-7,0 Z" fill="#ffffff" stroke="#0b0b0b" stroke-width="1.5"/></svg>`;
  if (!moving) return `<svg ${s}><circle r="5" fill="${cat.color}" stroke="#ffffff" stroke-width="2"/></svg>`;
  return `<svg ${s}><path d="M0,-10 L5.5,2 L4.5,8 L-4.5,8 L-5.5,2 Z" transform="rotate(${rot || 0})" fill="${cat.color}" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
}
const iconEl = (cat, kind, moving, rot, size = 16) => {
  const span = el("span", { className: "ic" });
  span.innerHTML = iconSVG(cat, kind, moving, rot, size);   // SVG generado aquí (sin datos externos)
  return span;
};
const fmtDur = (s) => (s < 60 ? `${Math.round(s)} s` : s < 3600 ? `${Math.round(s / 60)} min`
  : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`);

const S = { camp: null, status: null, days: [], day: null, trips: [], bins: [], rows: [], sel: null,
            ships: [], ship: null, shipTrips: [], shipRows: [], plots: [], map: null, segCache: new Map(),
            paths: [], shipPaths: [], meteo: new Map(), meteoMonths: new Map() };

// ---------------------------------------------------------------- carga
async function getJSON(url, bust = true) {
  const r = await fetch(bust ? `${url}?v=${Date.now()}` : url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function getTracks(url, bust) {
  if (!bust && S.segCache.has(url)) return S.segCache.get(url);   // segmentos cerrados: inmutables
  const r = await fetch(bust ? `${url}?v=${Date.now()}` : url);
  if (!r.ok) return [];
  const txt = await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text();
  const lines = txt.split("\n");
  const head = lines[0].split(",");
  const num = new Set(["t", "lat", "lon", "sog", "cog", "dist_km", "p", "snr", "mov"]);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const v = lines[i].split(",");
    const o = {};
    head.forEach((h, k) => { o[h] = num.has(h) ? (v[k] === "" ? null : +v[k]) : v[k]; });
    out.push(o);
  }
  if (!bust) S.segCache.set(url, out);
  return out;
}

const base = () => `data/${S.camp}/`;
const segURL = (s, kind = "tracks") => (s === "current" ? [`${base()}${kind}/current.csv.gz`, true]
                                                         : [`${base()}${kind}/${s}.csv.gz`, false]);

// Estado del mar (PORTUS): un archivo por mes; se cargan los meses de los días pedidos
async function ensureMeteo(days) {
  const st = (S.status || {}).meteo_station;
  if (!st) return;
  const months = [...new Set(days.filter(Boolean).map((d) => d.slice(0, 7)))];
  await Promise.all(months.map(async (mo) => {
    const now = new Date().toISOString().slice(0, 7);
    if (S.meteoMonths.has(mo) && mo !== now) return;            // el mes en curso se refresca
    const rows = await getJSON(`data/meteo/portus_${st}/${mo}.json`).catch(() => []);
    S.meteoMonths.set(mo, true);
    for (const r of rows) S.meteo.set(r.t, r);
  }));
}
const meteoAt = (t) => {                     // registro más cercano (≤ 45 min)
  let best = null;
  for (const [mt, r] of S.meteo) if (Math.abs(mt - t) <= 2700 && (!best || Math.abs(mt - t) < Math.abs(best.t - t))) best = r;
  return best;
};
const meteoText = (m) => (m ? `Mar (boya de Cartagena): Hm0 ${fmt1(m.hm0_m)} m, Tp ${fmt1(m.tp_s)} s, de ${Math.round(m.wave_dir_deg)}° · `
  + `viento ${fmt1(m.wind_ms)} m/s del ${Math.round(m.wind_dir_deg)}° · ${Math.round(m.pressure_mb)} hPa · ${fmt1(m.air_temp_c)} °C` : "");

async function loadCampaign(name) {
  S.camp = name;
  [S.status, S.days, S.ships] = await Promise.all([getJSON(base() + "status.json"),
    getJSON(base() + "days.json").catch(() => []), getJSON(base() + "ships.json").catch(() => [])]);
  const days = S.days.map((d) => d.day).sort().reverse();
  $("#day").replaceChildren(...days.map((d) => el("option", { value: d, textContent: d })));
  if (!days.includes(S.day)) S.day = days[0] || null;
  if (S.day) $("#day").value = S.day;
}

async function loadDay(day) {
  S.day = day;
  if (!day) { S.trips = []; S.bins = []; S.rows = []; return; }
  const [trips, bins] = await Promise.all([getJSON(`${base()}trips/${day}.json`).catch(() => []),
                                           getJSON(`${base()}bins/${day}.json`).catch(() => [])]);
  const segs = [...new Set(trips.flatMap((t) => t.segs))];
  const [parts, pparts] = await Promise.all([Promise.all(segs.map((s) => getTracks(...segURL(s)))),
                                             Promise.all(segs.map((s) => getTracks(...segURL(s, "paths")))),
                                             ensureMeteo([day])]);
  const ids = new Set(trips.map((t) => t.trip));
  S.trips = trips;
  S.bins = bins;
  S.rows = parts.flat().filter((r) => ids.has(r.trip)).sort((a, b) => a.t - b.t);
  S.paths = pparts.flat().filter((r) => ids.has(r.trip)).sort((a, b) => a.t - b.t);
}

// Todos los trayectos de un barco (todos los días en que se movió)
async function loadShip(mmsi) {
  const ship = S.ships.find((s) => s.mmsi === mmsi);
  const days = ship ? ship.days : [];
  const trips = (await Promise.all(days.map((d) => getJSON(`${base()}trips/${d}.json`).catch(() => []))))
    .flat().filter((t) => t.mmsi === mmsi);
  const segs = [...new Set(trips.flatMap((t) => t.segs))];
  const [parts, pparts] = await Promise.all([Promise.all(segs.map((s) => getTracks(...segURL(s)))),
                                             Promise.all(segs.map((s) => getTracks(...segURL(s, "paths")))),
                                             ensureMeteo(days)]);
  S.shipTrips = trips.sort((a, b) => b.start - a.start);
  S.shipRows = parts.flat().filter((r) => r.mmsi === mmsi).sort((a, b) => a.t - b.t);
  S.shipPaths = pparts.flat().filter((r) => r.mmsi === mmsi).sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------- cabecera (ambas pestañas)
function renderStatus() {
  const st = S.status || {};
  const last = st.last_burst_utc ? Date.parse(st.last_burst_utc) / 1000 : null;
  const age = last ? Date.now() / 1000 - last : Infinity;
  let kind, text;
  if (st.state === "detenida") [kind, text] = ["warning", "Captura detenida"];
  else if (age < 35 * 60) [kind, text] = ["good", st.state === "reintentando" ? "Reintentando" : "Capturando"];
  else [kind, text] = ["critical", "Sin datos recientes"];
  $("#status").replaceChildren(
    el("span", { className: "dot", style: `background:var(--${kind})` }),
    el("span", { textContent: { good: "✓", warning: "■", critical: "!" }[kind], ariaHidden: "true" }),
    el("span", { textContent: text }),
    el("small", { textContent: ` · última trama ${last ? ago(last) : "—"} · publicado ${st.published_utc ? ago(Date.parse(st.published_utc) / 1000) : "—"}` }));
  const rx = st.receiver || {};
  $("#subtitle").textContent = `${S.camp} · ${rx.name || ""} · ganancia ${st.gain_db ?? "?"} dB · barcos en movimiento: SOG ≥ ${st.min_sog_kn ?? 1} kn`;
}

// ---------------------------------------------------------------- pestaña Mapa
const shipInfo = (mmsi) => S.ships.find((s) => s.mmsi === mmsi) || {};

function visibleTrips() {
  const minn = Math.max(1, +$("#minn").value || 1);
  const q = $("#search").value.trim().toUpperCase();
  const src = S.ship ? S.shipTrips : S.trips;
  return src.filter((t) => t.n >= minn && (!q || t.mmsi.includes(q) || (t.name || "").toUpperCase().includes(q)))
            .sort((a, b) => b.start - a.start);
}

function renderTripList() {
  const sh = S.ship ? shipInfo(S.ship) : null;
  $("#list-title").textContent = sh ? `Trayectos de ${sh.name || "MMSI " + sh.mmsi}` : "Trayectos en movimiento";
  $("#back").hidden = !sh;
  const vis = visibleTrips();
  const items = vis.map((t) => {
    const info = shipInfo(t.mmsi);
    const li = el("li", { tabIndex: 0, className: t.trip === S.sel ? "sel" : "" },
      el("div", { className: "name" }, iconEl(catOf(info.type || t.type), kindOf(t.class), true, 0, 14), t.name || `MMSI ${t.mmsi}`),
      el("div", { className: "meta", textContent: `${S.ship ? new Date(t.start * 1000).toLocaleDateString("es-ES") + " " : ""}`
        + `${fmtHM(t.start)}–${fmtHM(t.end)} (${fmtDur(t.end - t.start)}) · ${fmtInt(t.n)} tramas · ${fmt1(t.sog_med)} kn` }),
      el("div", { className: "meta", textContent: `${t.d_min != null ? `${fmt1(t.d_min)}–${fmt1(t.d_max)} km` : "sin posición"} · ${fmt1(t.p_min)} … ${fmt1(t.p_max)} dBFS` }));
    const pick = () => selectTrip(t.trip);
    li.addEventListener("click", pick);
    li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
    return li;
  });
  $("#trip-list").replaceChildren(...(items.length ? items
    : [el("li", { className: "empty", textContent: (S.ship ? S.shipTrips : S.trips).length ? "Ningún trayecto con estos filtros" : "Sin trayectos" })]));
}

function initMap() {
  const sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 19, attribution: "Imágenes © Esri, Maxar, Earthstar Geographics" });
  const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" });
  S.map = L.map("map", { layers: [sat], scrollWheelZoom: true });
  L.control.layers({ "Satélite": sat, "Mapa": osm }, null, { position: "topright" }).addTo(S.map);
  L.control.scale({ imperial: false }).addTo(S.map);
  S.layer = L.layerGroup().addTo(S.map);
  S.fleet = L.layerGroup().addTo(S.map);
  const rx = (S.status || {}).receiver || {};
  S.map.setView([rx.lat || 37.6, rx.lon || -0.98], 13);
}

// Barcos en su última posición (todos los vistos, según el filtro)
function fleetShips() {
  const mode = $("#fleet").value, now = Date.now() / 1000;
  const minSog = (S.status || {}).min_sog_kn ?? 1;
  return S.ships.filter((s) => s.lat != null && (
    mode === "all" || (mode === "24h" && s.last > now - 86400) || (mode === "1h" && s.last > now - 3600)
    || (mode === "moving" && s.sog != null && s.sog >= minSog && s.last > now - 3600)));
}

function renderFleet() {
  S.fleet.clearLayers();
  if ($("#fleet").value === "none") return;
  const now = Date.now() / 1000, minSog = (S.status || {}).min_sog_kn ?? 1;
  const rx = (S.status || {}).receiver || {};
  for (const s of fleetShips()) {
    const moving = s.sog != null && s.sog >= minSog && now - s.pos_t < 3600;
    const kind = kindOf(s.class), cat = catOf(s.type);
    const rot = s.cog ?? s.hdg ?? 0;
    const icon = L.divIcon({ html: iconSVG(cat, kind, moving, rot), className: "ship-ic", iconSize: [22, 22], iconAnchor: [11, 11] });
    const dist = rx.lat != null ? L.latLng(rx.lat, rx.lon).distanceTo([s.lat, s.lon]) / 1000 : null;
    const tipEl = el("div", {}, el("b", { textContent: s.name || `MMSI ${s.mmsi}` }),
      el("div", { textContent: `${kind === "ship" ? cat.label : s.class}${s.type ? " · " + s.type : ""} · MMSI ${s.mmsi}` }),
      el("div", { textContent: `${moving ? `${fmt1(s.sog)} kn, rumbo ${Math.round(rot)}°` : "parado"} · ${dist != null ? fmt1(dist) + " km" : ""}` }),
      el("div", { textContent: `posición ${ago(s.pos_t)} · ${s.trips ? `${s.trips} trayecto(s), ${fmtDur(s.moving_s)} en movimiento` : "sin trayectos en movimiento"}` }));
    L.marker([s.lat, s.lon], { icon, opacity: now - s.last > 3600 ? 0.55 : 1, keyboard: false })
      .bindTooltip(tipEl, { direction: "top", offset: [0, -8] })
      .on("click", () => (s.trips ? selectShip(s.mmsi) : null)).addTo(S.fleet);
  }
}

function renderFleetLegend() {
  const items = CATS.map((c) => el("span", {}, iconEl(c, "ship", true, 45), c.label));
  items.push(el("span", {}, iconEl(CATS[7], "ship", false), "parado"),
             el("span", {}, iconEl(CATS[7], "base", false), "estación base"),
             el("span", {}, iconEl(CATS[7], "aton", false), "AtoN"));
  $("#fleet-legend").replaceChildren(...items);
}

function renderMap() {
  if (!S.map) initMap();
  S.layer.clearLayers();
  const rx = (S.status || {}).receiver || {};
  const vis = visibleTrips();
  const ids = new Set(vis.map((t) => t.trip));
  const pool = S.ship ? S.shipRows : S.rows;
  const rows = pool.filter((r) => ids.has(r.trip) && r.lat != null);
  // Resaltado: el trayecto elegido; en modo barco, todos sus trayectos
  const hl = S.sel ? rows.filter((r) => r.trip === S.sel) : S.ship ? rows : [];
  const scale = hl.length ? hl : rows;
  const ps = scale.map((r) => r.p);
  const lo = ps.length ? Math.min(...ps) : -60, hi = ps.length ? Math.max(...ps) : -30;

  // Vista primero (antes de añadir líneas)
  const hlPath = (S.ship ? S.shipPaths : S.paths).filter((r) => hl.some((h) => h.trip === r.trip));
  const pts = (hl.length ? [...hl, ...hlPath] : rows).map((r) => [r.lat, r.lon]);
  if (rx.lat != null && !hl.length) pts.push([rx.lat, rx.lon]);
  if (pts.length > 1) S.map.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 16 });

  // Línea = recorrido completo (todas las posiciones de AIS-catcher); si falta, las tramas medidas
  const ppool = (S.ship ? S.shipPaths : S.paths).filter((r) => ids.has(r.trip));
  const byTrip = new Map();
  for (const r of rows) byTrip.set(r.trip, []);
  for (const r of ppool) (byTrip.get(r.trip) || byTrip.set(r.trip, []).get(r.trip)).push(r);
  for (const r of rows) if (!ppool.some((p) => p.trip === r.trip)) byTrip.get(r.trip).push(r);
  const hlTrips = new Set(hl.map((r) => r.trip));
  for (const [trip, tr] of byTrip) {
    if (!tr.length) continue;
    const isHl = hlTrips.has(trip);
    const t = (S.ship ? S.shipTrips : S.trips).find((x) => x.trip === trip) || {};
    L.polyline(tr.map((r) => [r.lat, r.lon]), { color: "#ffffff", weight: isHl ? 3 : 2, opacity: isHl ? 0.9 : 0.45 })
      .bindTooltip(el("div", { textContent: `${t.name || t.mmsi} · ${fmtHM(t.start)}–${fmtHM(t.end)} (${fmtDur(t.end - t.start)})` }), { sticky: true })
      .on("click", () => selectTrip(trip)).addTo(S.layer);
  }
  for (const r of hl) {
    L.circleMarker([r.lat, r.lon], { radius: r.pos === "f" ? 6 : 4, color: "#1a1a19", weight: 1.5,
                                     fillColor: rampColor(r.p, lo, hi), fillOpacity: 1 })
      .bindTooltip(el("div", {}, el("b", { textContent: `${fmt1(r.p)} dBFS` }),
        el("div", { textContent: `${fmtTime(r.t)} · canal ${r.ch} · SNR ${fmt1(r.snr)} dB` }),
        el("div", { textContent: `${fmt1(r.dist_km)} km · ${fmt1(r.sog)} kn · posición ${r.pos === "f" ? "trama" : "interp."}` })))
      .addTo(S.layer);
  }
  if (rx.lat != null) {
    L.circleMarker([rx.lat, rx.lon], { radius: 7, color: "#ffffff", weight: 2, fillColor: "#0b0b0b", fillOpacity: 1 })
      .bindTooltip(el("div", { textContent: `Receptor · ${rx.name || ""}` })).addTo(S.layer);
  }
  renderFleet();
  $("#map-legend").replaceChildren(
    el("span", { textContent: `${fmt1(lo)} dBFS` }),
    el("span", { className: "bar" }, ...ramp().map((c) => el("span", { style: `background:${c}` }))),
    el("span", { textContent: `${fmt1(hi)} dBFS` }),
    el("span", { textContent: "· potencia de cada trama (marca grande = posición de la propia trama, pequeña = interpolada) · ● negro = receptor" }));
}

function renderTripDetail() {
  S.plots.forEach((u) => u.destroy());
  S.plots = [];
  const pool = S.ship ? S.shipTrips : S.trips;
  const t = pool.find((x) => x.trip === S.sel);
  const rowsAll = S.ship ? S.shipRows : S.rows;
  $("#dl-trip").disabled = !(t || S.ship);
  $("#dl-trip").textContent = !t && S.ship ? "Descargar barco (CSV)" : "Descargar trayecto (CSV)";
  $("#ship-btn").hidden = !t || !!S.ship;
  if (S.ship && !t) {                                   // modo barco: resumen de todo su recorrido
    const sh = shipInfo(S.ship), cat = catOf(sh.type);
    $("#trip-title").textContent = `${sh.name || "(sin nombre)"} · MMSI ${sh.mmsi} · recorrido completo`;
    const total = S.shipTrips.reduce((a, x) => a + (x.end - x.start), 0);
    const ds = S.shipTrips.flatMap((x) => [x.d_min, x.d_max]).filter((v) => v != null);
    $("#trip-note").textContent = `${kindOf(sh.class) === "ship" ? cat.label : sh.class}${sh.type ? " · " + sh.type : ""} · `
      + `${S.shipTrips.length} trayectos · ${fmtDur(total)} capturado en movimiento · ${fmtInt(S.shipRows.length)} tramas · `
      + `${ds.length ? `${fmt1(Math.min(...ds))}–${fmt1(Math.max(...ds))} km · ` : ""}`
      + `visto ${fmtTime(sh.first)} – ${fmtTime(sh.last)}`;
    renderDistChart(S.shipRows);
    renderTimeChart(S.shipRows);
    return;
  }
  if (!t) {
    $("#trip-title").textContent = "Elige un trayecto";
    $("#trip-note").textContent = "Selecciónalo en la lista, haz clic en su línea o en un barco del mapa (recorrido completo).";
    $("#c-dist").replaceChildren(el("div", { className: "empty", textContent: "—" }));
    $("#c-time").replaceChildren(el("div", { className: "empty", textContent: "—" }));
    return;
  }
  const rows = rowsAll.filter((r) => r.trip === S.sel);
  $("#trip-title").textContent = `${t.name || "(sin nombre)"} · MMSI ${t.mmsi}`;
  const nf = rows.filter((r) => r.pos === "f").length;
  const sh = shipInfo(t.mmsi);
  $("#trip-note").textContent = `${kindOf(t.class) === "ship" ? catOf(sh.type || t.type).label : t.class}${t.type ? " · " + t.type : ""} · `
    + `${fmtTime(t.start)} – ${fmtHM(t.end)} (${fmtDur(t.end - t.start)}) · `
    + `${fmtInt(t.n)} tramas (A ${t.nA} · B ${t.nB}) · ${nf} con posición propia · `
    + `${t.d_min != null ? `${fmt1(t.d_min)}–${fmt1(t.d_max)} km · ` : ""}SOG mediana ${fmt1(t.sog_med)} kn`
    + (sh.trips > 1 ? ` · este barco tiene ${sh.trips} trayectos (${fmtDur(sh.moving_s)} en total)` : "")
    + (meteoAt((t.start + t.end) / 2) ? `\n${meteoText(meteoAt((t.start + t.end) / 2))}` : "");
  renderDistChart(rows);
  renderTimeChart(rows);
}

// Potencia frente a distancia (SVG; dos series: canal A y B)
function renderDistChart(rows) {
  const box = $("#c-dist");
  box.replaceChildren();
  const d = rows.filter((r) => r.dist_km != null);
  if (!d.length) { box.append(el("div", { className: "empty", textContent: "Sin posiciones" })); return; }
  box.append(el("div", { className: "legend" }, ...[["A", "--s1"], ["B", "--s2"]].map(([c, v]) =>
    el("span", {}, el("span", { className: "key", style: `background:${cssVar(v)}` }), `Canal ${c}`))));
  const W = box.clientWidth, H = 240, m = { l: 52, r: 12, t: 22, b: 34 };
  const xs = d.map((r) => r.dist_km), ys = d.map((r) => r.p);
  const x0 = Math.max(0, Math.floor(Math.min(...xs) * 10) / 10 - 0.1), x1 = Math.ceil(Math.max(...xs) * 10) / 10 + 0.1;
  const y0 = Math.floor((Math.min(...ys) - 2) / 5) * 5, y1 = Math.ceil((Math.max(...ys) + 2) / 5) * 5;
  const X = (v) => m.l + ((v - x0) / (x1 - x0)) * (W - m.l - m.r);
  const Y = (v) => m.t + ((y1 - v) / (y1 - y0)) * (H - m.t - m.b);
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", W); svg.setAttribute("height", H); svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Potencia de cada trama frente a la distancia al receptor");
  const add = (tag, attrs, text) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    svg.append(e); return e;
  };
  const ink = cssVar("--ink-2"), grid = cssVar("--grid"), surf = cssVar("--surface");
  const ystep = y1 - y0 > 30 ? 10 : 5;
  for (let v = y0; v <= y1; v += ystep) {
    add("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), stroke: grid });
    add("text", { x: m.l - 6, y: Y(v) + 4, "text-anchor": "end", fill: ink, "font-size": 12 }, v);
  }
  const span = x1 - x0, xstep = span > 8 ? 2 : span > 4 ? 1 : span > 2 ? 0.5 : span > 1 ? 0.25 : 0.1;
  for (let v = Math.ceil(x0 / xstep) * xstep; v <= x1 + 1e-9; v += xstep) {
    add("line", { x1: X(v), x2: X(v), y1: m.t, y2: H - m.b, stroke: grid });
    add("text", { x: X(v), y: H - m.b + 16, "text-anchor": "middle", fill: ink, "font-size": 12 }, +v.toFixed(2));
  }
  add("text", { x: W - m.r, y: H - 4, "text-anchor": "end", fill: ink, "font-size": 12 }, "distancia al receptor (km)");
  add("text", { x: 4, y: 12, fill: ink, "font-size": 12 }, "dBFS");
  for (const r of d) {
    const c = cssVar(r.ch === "A" ? "--s1" : "--s2");
    add("circle", { cx: X(r.dist_km), cy: Y(r.p), r: 4, fill: c, stroke: surf, "stroke-width": 1.5 });
    const hit = add("circle", { cx: X(r.dist_km), cy: Y(r.p), r: 10, fill: "transparent" });
    hit.addEventListener("pointermove", (ev) => tip(ev, [[`${fmt1(r.p)} dBFS`, `canal ${r.ch}`],
      [`${r.dist_km.toFixed(3)} km`, fmtTime(r.t)], [`${fmt1(r.snr)} dB`, "SNR"]]));
    hit.addEventListener("pointerleave", () => ($("#tip").hidden = true));
  }
  box.append(svg);
}

function tip(ev, rows) {
  const t = $("#tip");
  t.replaceChildren(...rows.map(([v, l]) => el("div", {}, el("b", { textContent: v }), ` ${l}`)));
  t.hidden = false;
  t.style.left = `${Math.min(ev.clientX + 12, innerWidth - t.offsetWidth - 8)}px`;
  t.style.top = `${ev.clientY + 12}px`;
}

function uplotAxes(yLabel) {
  const ink = cssVar("--ink-2"), grid = cssVar("--grid");
  const c = { stroke: ink, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid, width: 1 }, font: "12px system-ui, sans-serif",
              labelFont: "12px system-ui, sans-serif" };
  return [{ ...c }, { ...c, label: yLabel, size: 56 }];
}

function makePlot(target, data, series, yLabel, height = 230) {
  const box = $(target);
  box.replaceChildren();
  if (!data[0].length) { box.append(el("div", { className: "empty", textContent: "Sin datos" })); return; }
  const u = new uPlot({ width: box.clientWidth, height, axes: uplotAxes(yLabel), scales: { x: { time: true } },
                        cursor: { points: { size: 8 } },
                        series: [{ label: "Hora", value: (u, t) => (t == null ? "—" : fmtTime(t)) }, ...series] }, data, box);
  S.plots.push(u);
}

function renderTimeChart(rows) {
  const pt = (v) => ({ show: true, size: 6, fill: cssVar(v), stroke: cssVar(v) });
  const ser = (label, v) => ({ label, stroke: cssVar(v), paths: () => null, points: pt(v),
                               value: (u, x) => (x == null ? "—" : `${x.toFixed(1)} dBFS`) });
  makePlot("#c-time", [rows.map((r) => r.t), rows.map((r) => (r.ch === "A" ? r.p : null)), rows.map((r) => (r.ch === "B" ? r.p : null))],
           [ser("Canal A", "--s1"), ser("Canal B", "--s2")], "dBFS");
}

function renderMapTab() {
  renderTripList();
  renderMap();
  renderTripDetail();
}

function selectTrip(id) {
  S.sel = id;
  renderMapTab();
}

async function selectShip(mmsi) {
  document.body.style.opacity = 0.6;
  try {
    await loadShip(mmsi);
    S.ship = mmsi;
    S.sel = null;
    renderMapTab();
  } finally {
    document.body.style.opacity = 1;
  }
}

function leaveShip() {
  S.ship = null;
  S.sel = null;
  renderMapTab();
}

// ---------------------------------------------------------------- descargas (CSV generado en el navegador)
const METEO_COLS = ["hm0_m", "hmax_m", "tp_s", "wave_dir_deg", "wind_ms", "wind_dir_deg", "pressure_mb", "air_temp_c"];
const CSV_COLS = ["utc", "mmsi", "nombre", "trip", "ch", "lat", "lon", "pos", "sog_kn", "cog", "dist_km", "power_dbfs", "snr_db",
                  "msg_type", ...METEO_COLS.map((c) => "boya_" + c)];
function downloadCSV(rows, name) {
  const names = new Map([...S.trips, ...S.shipTrips].map((t) => [t.trip, t.name]));
  const esc = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = [CSV_COLS.join(",")].concat(rows.map((r) => [new Date(r.t * 1000).toISOString(), r.mmsi, names.get(r.trip) || "",
    r.trip, r.ch, r.lat, r.lon, r.pos, r.sog, r.cog, r.dist_km, r.p, r.snr, r.msg,
    ...METEO_COLS.map((c) => (meteoAt(r.t) || {})[c])].map(esc).join(",")));
  const a = el("a", { href: URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" })), download: name });
  document.body.append(a); a.click(); a.remove();
}

// ---------------------------------------------------------------- pestaña Estado
function renderEstado() {
  S.plots.forEach((u) => u.destroy());
  S.plots = [];
  const st = S.status || {};
  const hw = st.hw_last || {};
  const tiles = [
    ["Última trama", st.last_burst_utc ? ago(Date.parse(st.last_burst_utc) / 1000) : "—", st.last_burst_utc ? fmtTime(Date.parse(st.last_burst_utc) / 1000) : ""],
    ["Ráfagas (15 min)", fmtInt(st.bursts_last_15min), "en la última publicación"],
    ["En movimiento ahora", fmtInt((st.moving_now || []).length), "barcos en los últimos 15 min"],
    ["Ruido de canal", hw.noise_A_dbfs ? `${fmt1(+hw.noise_A_dbfs)} / ${fmt1(+hw.noise_B_dbfs)}` : "—", "dBFS, canal A / B"],
    ["Temperatura", hw.temp_c ? `${fmt1(+hw.temp_c)} °C` : "—", "AD9363"],
    ["Segmentos", `${st.segments_ok ?? 0} OK`, `${st.segments_failed ?? 0} fallidos${st.last_failure ? " · " + st.last_failure : ""}`],
    ["Config. restaurada", fmtInt(st.hw_restored_in_segment), "veces en el segmento actual (otro proceso tocó el Pluto)"],
    ["Disco libre", st.disk_free_gb != null ? `${st.disk_free_gb} GB` : "—", "PC de captura"],
  ];
  $("#tiles").replaceChildren(...tiles.map(([l, v, s]) => el("div", { className: "tile" },
    el("div", { className: "label", textContent: l }), el("div", { className: "value", textContent: v }),
    el("div", { className: "sub", textContent: s }))));
  const b = S.bins, x = b.map((r) => r.t);
  const line = (label, v, unit) => ({ label, stroke: cssVar(v), width: 2, points: { show: false },
                                      value: (u, y) => (y == null ? "—" : `${Number.isInteger(y) ? y : y.toFixed(1)}${unit}`) });
  makePlot("#c-count", [x, b.map((r) => r.nA), b.map((r) => r.nB)], [line("Canal A", "--s1", ""), line("Canal B", "--s2", "")], "ráfagas", 220);
  makePlot("#c-ships", [x, b.map((r) => r.ships), b.map((r) => r.moving)], [line("Barcos", "--s1", ""), line("En movimiento", "--s2", "")], "barcos", 220);
  makePlot("#c-noise", [x, b.map((r) => r.noiseA), b.map((r) => r.noiseB)], [line("Canal A", "--s1", " dBFS"), line("Canal B", "--s2", " dBFS")], "dBFS", 220);
  makePlot("#c-temp", [x, b.map((r) => r.temp)], [line("Temperatura", "--s1", " °C")], "°C", 220);
  makePlot("#c-ref", [x, b.map((r) => r.refA ?? null), b.map((r) => r.refB ?? null)],
           [line("Canal A", "--s1", " dBFS"), line("Canal B", "--s2", " dBFS")], "dBFS", 220);
  const d0 = Date.parse(`${S.day}T00:00:00Z`) / 1000;
  const m = [...S.meteo.values()].filter((r) => r.t >= d0 && r.t < d0 + 86400).sort((a, b) => a.t - b.t);
  makePlot("#c-wave", [m.map((r) => r.t), m.map((r) => r.hm0_m), m.map((r) => r.hmax_m)],
           [line("Hm0", "--s1", " m"), line("Hmax", "--s2", " m")], "m", 220);
  makePlot("#c-wind", [m.map((r) => r.t), m.map((r) => r.wind_ms)], [line("Viento", "--s1", " m/s")], "m/s", 220);

  const head = el("tr", {}, ...["Día (UTC)", "Trayectos", "Tramas en mov.", "Barcos", "En movimiento", ""].map((h, i) =>
    el("th", { textContent: h, className: i && i < 5 ? "num" : "" })));
  const rows = [...S.days].sort((a, b) => (a.day < b.day ? 1 : -1)).map((d) => {
    const btn = el("button", { className: "ghost", textContent: "Ver en el mapa" });
    btn.addEventListener("click", async () => { $("#day").value = d.day; await changeDay(d.day); showTab("mapa"); });
    return el("tr", {}, el("td", { textContent: d.day }), el("td", { className: "num", textContent: fmtInt(d.trips) }),
      el("td", { className: "num", textContent: fmtInt(d.frames) }), el("td", { className: "num", textContent: fmtInt(d.ships) }),
      el("td", { className: "num", textContent: fmtInt(d.moving_ships) }), el("td", {}, btn));
  });
  $("#days").replaceChildren(el("thead", {}, head), el("tbody", {}, ...rows));
}

// ---------------------------------------------------------------- orquestación
function current() { return location.hash === "#estado" ? "estado" : "mapa"; }

function showTab(name) {
  if (location.hash !== `#${name}`) history.replaceState(null, "", `#${name}`);
  for (const t of ["mapa", "estado"]) {
    $(`#tab-${t}`).setAttribute("aria-selected", String(t === name));
    $(`#p-${t}`).hidden = t !== name;
  }
  render();
}

function render() {
  renderStatus();
  if (current() === "mapa") {
    renderMapTab();
    S.map.invalidateSize();
  } else {
    renderEstado();
  }
}

async function changeDay(day) {
  document.body.style.opacity = 0.6;          // se mantiene lo dibujado mientras recarga
  try {
    await loadDay(day);
    if (S.ship) await loadShip(S.ship);                  // refrescar también el recorrido del barco
    const pool = S.ship ? S.shipTrips : S.trips;
    if (!pool.some((t) => t.trip === S.sel)) S.sel = null;
    render();
  } finally {
    document.body.style.opacity = 1;
  }
}

async function reload() {
  try {
    await loadCampaign(S.camp);
    await changeDay(S.day);
  } catch (e) {
    $("#subtitle").textContent = `Error cargando datos: ${e.message}`;
  }
}

async function init() {
  let camps = [];
  try { camps = await getJSON("data/campaigns.json"); } catch { /* aún sin datos */ }
  if (!camps.length) { $("#subtitle").textContent = "Todavía no hay campañas publicadas."; return; }
  $("#campaign").replaceChildren(...camps.map((c) => el("option", { value: c.name, textContent: c.name })));
  S.camp = camps[0].name;
  $("#campaign").addEventListener("change", (e) => { S.camp = e.target.value; S.day = null; S.sel = null; reload(); });
  $("#day").addEventListener("change", (e) => changeDay(e.target.value));
  $("#reload").addEventListener("click", reload);
  $("#minn").addEventListener("input", () => { renderTripList(); renderMap(); });
  $("#search").addEventListener("input", () => { renderTripList(); renderMap(); });
  $("#tab-mapa").addEventListener("click", () => showTab("mapa"));
  $("#tab-estado").addEventListener("click", () => showTab("estado"));
  $("#dl-trip").addEventListener("click", () => {
    const rows = S.ship ? S.shipRows : S.rows;
    if (S.sel) downloadCSV(rows.filter((r) => r.trip === S.sel), `${S.sel}.csv`);
    else if (S.ship) downloadCSV(rows, `barco_${S.ship}.csv`);
  });
  $("#ship-btn").addEventListener("click", () => {
    const t = S.trips.find((x) => x.trip === S.sel);
    if (t) selectShip(t.mmsi);
  });
  $("#back").addEventListener("click", leaveShip);
  $("#fleet").addEventListener("change", () => { if (S.map) renderFleet(); });
  renderFleetLegend();
  $("#dl-day").addEventListener("click", () => downloadCSV(S.rows, `trayectos_${S.camp}_${S.day}.csv`));
  let rt;
  addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(render, 200); });
  addEventListener("hashchange", () => showTab(current()));
  setInterval(reload, 5 * 60 * 1000);          // los datos se publican cada 15 min
  S.sel = new URLSearchParams(location.search).get("trip");   // enlace directo a un trayecto
  if (S.sel) S.day = (() => { const m = S.sel.match(/-(\d{4})(\d{2})(\d{2})T/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; })();
  await reload();
  const ship = new URLSearchParams(location.search).get("ship");   // enlace directo a un barco
  if (ship && S.ships.some((x) => x.mmsi === ship)) await selectShip(ship);
  showTab(current());
}

init();
