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
const GROUPS = [
  { label: "Clase A (12,5 W)", color: "--s1", match: (c) => c.startsWith("Clase A") },
  { label: "Clase B (2–5 W)", color: "--s2", match: (c) => c.startsWith("Clase B") },
  { label: "Estación fija", color: "--s3", match: (c) => c.startsWith("Estación") || c.startsWith("Ayuda") },
  { label: "Otro", color: "--other", match: () => true },
];
const groupOf = (cls) => GROUPS.find((g) => g.match(cls || ""));

const S = { camp: null, status: null, days: [], day: null, trips: [], bins: [], rows: [], sel: null,
            plots: [], map: null };

// ---------------------------------------------------------------- carga
async function getJSON(url, bust = true) {
  const r = await fetch(bust ? `${url}?v=${Date.now()}` : url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function getTracks(url, bust) {
  const r = await fetch(bust ? `${url}?v=${Date.now()}` : url);
  if (!r.ok) return [];
  const txt = await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text();
  const lines = txt.split("\n");
  const head = lines[0].split(",");
  const num = new Set(["t", "lat", "lon", "sog", "cog", "dist_km", "p", "snr"]);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const v = lines[i].split(",");
    const o = {};
    head.forEach((h, k) => { o[h] = num.has(h) ? (v[k] === "" ? null : +v[k]) : v[k]; });
    out.push(o);
  }
  return out;
}

const base = () => `data/${S.camp}/`;

async function loadCampaign(name) {
  S.camp = name;
  [S.status, S.days] = await Promise.all([getJSON(base() + "status.json"), getJSON(base() + "days.json").catch(() => [])]);
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
  const parts = await Promise.all(segs.map((s) => s === "current"
    ? getTracks(`${base()}tracks/current.csv.gz`, true)
    : getTracks(`${base()}tracks/${s}.csv.gz`, false)));
  const ids = new Set(trips.map((t) => t.trip));
  S.trips = trips;
  S.bins = bins;
  S.rows = parts.flat().filter((r) => ids.has(r.trip)).sort((a, b) => a.t - b.t);
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
function visibleTrips() {
  const minn = Math.max(1, +$("#minn").value || 1);
  const q = $("#search").value.trim().toUpperCase();
  return S.trips.filter((t) => t.n >= minn && (!q || t.mmsi.includes(q) || (t.name || "").toUpperCase().includes(q)))
                .sort((a, b) => b.start - a.start);
}

function renderTripList() {
  const vis = visibleTrips();
  const items = vis.map((t) => {
    const li = el("li", { tabIndex: 0, className: t.trip === S.sel ? "sel" : "" },
      el("div", { className: "name" }, el("span", { className: "key", style: `background:${cssVar(groupOf(t.class).color)}` }),
         t.name || `MMSI ${t.mmsi}`),
      el("div", { className: "meta", textContent: `${fmtHM(t.start)}–${fmtHM(t.end)} · ${fmtInt(t.n)} tramas · ${t.sog_med} kn` }),
      el("div", { className: "meta", textContent: `${t.d_min != null ? `${fmt1(t.d_min)}–${fmt1(t.d_max)} km` : "sin posición"} · ${fmt1(t.p_min)} … ${fmt1(t.p_max)} dBFS` }));
    const pick = () => selectTrip(t.trip);
    li.addEventListener("click", pick);
    li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
    return li;
  });
  $("#trip-list").replaceChildren(...(items.length ? items
    : [el("li", { className: "empty", textContent: S.trips.length ? "Ningún trayecto con estos filtros" : "Sin trayectos este día" })]));
}

function initMap() {
  const sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 19, attribution: "Imágenes © Esri, Maxar, Earthstar Geographics" });
  const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" });
  S.map = L.map("map", { layers: [sat], scrollWheelZoom: true });
  L.control.layers({ "Satélite": sat, "Mapa": osm }, null, { position: "topright" }).addTo(S.map);
  L.control.scale({ imperial: false }).addTo(S.map);
  S.layer = L.layerGroup().addTo(S.map);
  const rx = (S.status || {}).receiver || {};
  S.map.setView([rx.lat || 37.6, rx.lon || -0.98], 13);
}

function renderMap() {
  if (!S.map) initMap();
  S.layer.clearLayers();
  const rx = (S.status || {}).receiver || {};
  const vis = visibleTrips();
  const ids = new Set(vis.map((t) => t.trip));
  const rows = S.rows.filter((r) => ids.has(r.trip) && r.lat != null);
  const sel = S.rows.filter((r) => r.trip === S.sel && r.lat != null);
  const ps = rows.map((r) => r.p);
  const lo = ps.length ? Math.min(...ps) : -60, hi = ps.length ? Math.max(...ps) : -30;

  // Vista primero (antes de añadir líneas): el trayecto elegido, o todos, o el receptor
  const pts = (sel.length ? sel : rows).map((r) => [r.lat, r.lon]);
  if (rx.lat != null && !sel.length) pts.push([rx.lat, rx.lon]);
  if (pts.length > 1) S.map.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 16 });

  // Todos los trayectos visibles: líneas finas (clic = seleccionar)
  const byTrip = new Map();
  for (const r of rows) (byTrip.get(r.trip) || byTrip.set(r.trip, []).get(r.trip)).push([r.lat, r.lon]);
  for (const [trip, line] of byTrip) {
    if (trip === S.sel) continue;
    const t = S.trips.find((x) => x.trip === trip);
    L.polyline(line, { color: "#ffffff", weight: 2, opacity: 0.45 })
      .bindTooltip(el("div", { textContent: `${t.name || t.mmsi} · ${fmtHM(t.start)}–${fmtHM(t.end)}` }), { sticky: true })
      .on("click", () => selectTrip(trip)).addTo(S.layer);
  }
  // Trayecto elegido: línea + una marca por trama coloreada por potencia
  if (sel.length) {
    L.polyline(sel.map((r) => [r.lat, r.lon]), { color: "#ffffff", weight: 3, opacity: 0.9 }).addTo(S.layer);
    for (const r of sel) {
      L.circleMarker([r.lat, r.lon], { radius: r.pos === "f" ? 6 : 4, color: "#1a1a19", weight: 1.5,
                                       fillColor: rampColor(r.p, lo, hi), fillOpacity: 1 })
        .bindTooltip(el("div", {}, el("b", { textContent: `${fmt1(r.p)} dBFS` }),
          el("div", { textContent: `${fmtHMS(r.t)} · canal ${r.ch} · SNR ${fmt1(r.snr)} dB` }),
          el("div", { textContent: `${fmt1(r.dist_km)} km · ${fmt1(r.sog)} kn · posición ${r.pos === "f" ? "trama" : "interp."}` })))
        .addTo(S.layer);
    }
  }
  if (rx.lat != null) {
    L.circleMarker([rx.lat, rx.lon], { radius: 7, color: "#ffffff", weight: 2, fillColor: "#0b0b0b", fillOpacity: 1 })
      .bindTooltip(el("div", { textContent: `Receptor · ${rx.name || ""}` })).addTo(S.layer);
  }
  $("#map-legend").replaceChildren(
    el("span", { textContent: `${fmt1(lo)} dBFS` }),
    el("span", { className: "bar" }, ...ramp().map((c) => el("span", { style: `background:${c}` }))),
    el("span", { textContent: `${fmt1(hi)} dBFS` }),
    el("span", { textContent: "· marca grande = posición de la propia trama, pequeña = interpolada · ● negro = receptor" }));
}

function renderTripDetail() {
  S.plots.forEach((u) => u.destroy());
  S.plots = [];
  const t = S.trips.find((x) => x.trip === S.sel);
  const rows = S.rows.filter((r) => r.trip === S.sel);
  $("#dl-trip").disabled = !t;
  if (!t) {
    $("#trip-title").textContent = "Elige un trayecto";
    $("#trip-note").textContent = "Selecciónalo en la lista o haz clic en su línea del mapa.";
    $("#c-dist").replaceChildren(el("div", { className: "empty", textContent: "—" }));
    $("#c-time").replaceChildren(el("div", { className: "empty", textContent: "—" }));
    return;
  }
  $("#trip-title").textContent = `${t.name || "(sin nombre)"} · MMSI ${t.mmsi}`;
  const nf = rows.filter((r) => r.pos === "f").length;
  $("#trip-note").textContent = `${t.class}${t.type ? " · " + t.type : ""} · ${fmtTime(t.start)} – ${fmtHM(t.end)} · `
    + `${fmtInt(t.n)} tramas (A ${t.nA} · B ${t.nB}) · ${nf} con posición propia · `
    + `${t.d_min != null ? `${fmt1(t.d_min)}–${fmt1(t.d_max)} km · ` : ""}SOG mediana ${t.sog_med} kn`;
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
  const W = box.clientWidth, H = 230, m = { l: 52, r: 12, t: 10, b: 34 };
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
  add("text", { x: 4, y: m.t + 10, fill: ink, "font-size": 12 }, "dBFS");
  for (const r of d) {
    const c = cssVar(r.ch === "A" ? "--s1" : "--s2");
    add("circle", { cx: X(r.dist_km), cy: Y(r.p), r: 4, fill: c, stroke: surf, "stroke-width": 1.5 });
    const hit = add("circle", { cx: X(r.dist_km), cy: Y(r.p), r: 10, fill: "transparent" });
    hit.addEventListener("pointermove", (ev) => tip(ev, [[`${fmt1(r.p)} dBFS`, `canal ${r.ch}`],
      [`${r.dist_km.toFixed(3)} km`, fmtHMS(r.t)], [`${fmt1(r.snr)} dB`, "SNR"]]));
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
                        series: [{ label: "Hora", value: (u, t) => (t == null ? "—" : fmtHMS(t)) }, ...series] }, data, box);
  S.plots.push(u);
}

function renderTimeChart(rows) {
  const pt = (v) => ({ show: true, size: 6, fill: cssVar(v), stroke: cssVar(v) });
  const ser = (label, v) => ({ label, stroke: cssVar(v), paths: () => null, points: pt(v),
                               value: (u, x) => (x == null ? "—" : `${x.toFixed(1)} dBFS`) });
  makePlot("#c-time", [rows.map((r) => r.t), rows.map((r) => (r.ch === "A" ? r.p : null)), rows.map((r) => (r.ch === "B" ? r.p : null))],
           [ser("Canal A", "--s1"), ser("Canal B", "--s2")], "dBFS");
}

function selectTrip(id) {
  S.sel = id;
  renderTripList();
  renderMap();
  renderTripDetail();
}

// ---------------------------------------------------------------- descargas (CSV generado en el navegador)
const CSV_COLS = ["utc", "mmsi", "nombre", "trip", "ch", "lat", "lon", "pos", "sog_kn", "cog", "dist_km", "power_dbfs", "snr_db", "msg_type"];
function downloadCSV(rows, name) {
  const names = new Map(S.trips.map((t) => [t.trip, t.name]));
  const esc = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = [CSV_COLS.join(",")].concat(rows.map((r) => [new Date(r.t * 1000).toISOString(), r.mmsi, names.get(r.trip) || "",
    r.trip, r.ch, r.lat, r.lon, r.pos, r.sog, r.cog, r.dist_km, r.p, r.snr, r.msg].map(esc).join(",")));
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
    renderTripList();
    renderMap();
    S.map.invalidateSize();
    renderTripDetail();
  } else {
    renderEstado();
  }
}

async function changeDay(day) {
  document.body.style.opacity = 0.6;          // se mantiene lo dibujado mientras recarga
  try {
    await loadDay(day);
    if (!S.trips.some((t) => t.trip === S.sel)) S.sel = null;
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
    const t = S.trips.find((x) => x.trip === S.sel);
    if (t) downloadCSV(S.rows.filter((r) => r.trip === S.sel), `${t.trip}.csv`);
  });
  $("#dl-day").addEventListener("click", () => downloadCSV(S.rows, `trayectos_${S.camp}_${S.day}.csv`));
  let rt;
  addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(render, 200); });
  addEventListener("hashchange", () => showTab(current()));
  setInterval(reload, 5 * 60 * 1000);          // los datos se publican cada 15 min
  S.sel = new URLSearchParams(location.search).get("trip");   // enlace directo a un trayecto
  if (S.sel) S.day = (() => { const m = S.sel.match(/-(\d{4})(\d{2})(\d{2})T/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; })();
  await reload();
  showTab(current());
}

init();
