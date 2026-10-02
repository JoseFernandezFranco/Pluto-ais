// Dashboard Pluto-AIS: lee data/ (generado por plutoais.publish) y dibuja estado, series,
// potencia por transmisor, mapa y tablas. Sin compilación: HTML + uPlot + Leaflet.
"use strict";

const $ = (s) => document.querySelector(s);
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of kids) e.append(k);
  return e;
};
const fmtInt = (n) => n.toLocaleString("es-ES");
const fmtDb = (v) => (v == null ? "—" : v.toFixed(1));
const fmtTime = (t) => new Date(t * 1000).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
const ago = (t) => {
  const m = Math.round((Date.now() / 1000 - t) / 60);
  return m < 1 ? "hace <1 min" : m < 90 ? `hace ${m} min` : `hace ${(m / 60).toFixed(1)} h`;
};
const median = (a) => {
  if (!a.length) return null;
  const s = Float64Array.from(a).sort();
  return s[Math.floor((s.length - 1) * 0.5)];
};
const pct = (s, q) => s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * q)))];

// Clase de transmisor → grupo de color (3 grupos + "Otro" en gris)
const GROUPS = [
  { key: "A", label: "Clase A (12,5 W)", color: "--s1", match: (c) => c.startsWith("Clase A") },
  { key: "B", label: "Clase B (2–5 W)", color: "--s2", match: (c) => c.startsWith("Clase B") },
  { key: "F", label: "Estación fija (base / AtoN)", color: "--s3", match: (c) => c.startsWith("Estación") || c.startsWith("Ayuda") },
  { key: "O", label: "Otro", color: "--other", match: () => true },
];
const groupOf = (cls) => GROUPS.find((g) => g.match(cls || ""));

const S = { camp: null, status: null, summary: null, pts: null, range: "all", sel: null,
            sort: { k: "n", dir: -1 }, plots: [], map: null };

// ---------------------------------------------------------------- carga de datos
async function getJSON(url, bust = true) {
  const r = await fetch(bust ? `${url}?v=${Date.now()}` : url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function getPoints(url, bust) {
  const r = await fetch(bust ? `${url}?v=${Date.now()}` : url);
  if (!r.ok) return [];
  const txt = await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text();
  const rows = [];
  const lines = txt.split("\n");
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const [t, ch, mmsi, p, snr, id] = lines[i].split(",");
    rows.push({ t: +t, ch, mmsi, p: +p, snr: snr === "" ? null : +snr, id: +id });
  }
  return rows;
}

async function loadCampaign(name) {
  const base = `data/${name}/`;
  const [status, summary] = await Promise.all([getJSON(base + "status.json"), getJSON(base + "summary.json")]);
  // Segmentos cerrados: inmutables (caché del navegador); el actual: siempre fresco
  const parts = await Promise.all(summary.segments.filter((s) => s.points)
    .map((s) => getPoints(base + s.points, !s.closed)));
  const pts = parts.flat().sort((a, b) => a.t - b.t);
  Object.assign(S, { camp: name, status, summary, pts });
}

// ---------------------------------------------------------------- rango de tiempo
function rangeBounds() {
  const lastBin = S.summary.bins.length ? S.summary.bins.at(-1).t + S.summary.bin_s : 0;
  const tMax = Math.max(S.pts.length ? S.pts.at(-1).t : 0, lastBin);
  const tMin = S.range === "all" ? -Infinity : tMax - (+S.range) * 3600;
  return [tMin, tMax];
}

function vesselStats(pts) {
  const info = new Map(S.summary.vessels.map((v) => [v.mmsi, v]));
  const acc = new Map();
  for (const r of pts) {
    if (!r.mmsi) continue;
    let a = acc.get(r.mmsi);
    if (!a) acc.set(r.mmsi, (a = { p: [], nA: 0, nB: 0, last: 0 }));
    a.p.push(r.p);
    a[r.ch === "A" ? "nA" : "nB"]++;
    a.last = r.t;
  }
  const out = [];
  for (const [mmsi, a] of acc) {
    const s = Float64Array.from(a.p).sort();
    const v = info.get(mmsi) || {};
    out.push({ mmsi, name: v.name || "", cls: v.class || "", n: s.length, nA: a.nA, nB: a.nB,
               p_med: pct(s, 0.5), p10: pct(s, 0.1), p90: pct(s, 0.9),
               dist_km: v.dist_km ?? null, lat: v.lat, lon: v.lon, last: a.last });
  }
  return out;
}

// ---------------------------------------------------------------- estado y cifras
function renderStatus() {
  const st = S.status;
  const box = $("#status");
  box.replaceChildren();
  const last = st.last_burst_utc ? Date.parse(st.last_burst_utc) / 1000 : null;
  const age = last ? Date.now() / 1000 - last : Infinity;
  let kind, text;
  if (st.state === "detenida") [kind, text] = ["warning", "Captura detenida"];
  else if (age < 35 * 60) [kind, text] = ["good", st.state === "reintentando" ? "Reintentando" : "Capturando"];
  else [kind, text] = ["critical", "Sin datos recientes"];
  const icon = { good: "✓", warning: "■", critical: "!" }[kind];
  box.append(el("span", { className: "dot", style: `background:var(--${kind})` }),
             el("span", { className: "icon", textContent: icon, ariaHidden: "true" }),
             el("span", { textContent: text }),
             el("small", { textContent: ` · última ráfaga ${last ? ago(last) : "—"} · publicado ${ago(Date.parse(st.published_utc) / 1000)}` }));
  const rx = S.summary.receiver || {};
  $("#subtitle").textContent = `${S.camp} · ${rx.name || ""} · ganancia ${S.summary.gain_db ?? "?"} dB · `
    + `inicio ${st.start_utc ? fmtTime(Date.parse(st.start_utc) / 1000) : "—"}`;
}

function renderTiles(pts, vs) {
  const st = S.status;
  const ident = pts.reduce((n, r) => n + (r.id > 0), 0);
  const tiles = [
    ["Ráfagas", fmtInt(pts.length), `A ${fmtInt(pts.filter((r) => r.ch === "A").length)} · B ${fmtInt(pts.filter((r) => r.ch === "B").length)}`],
    ["Identificadas", pts.length ? `${Math.round(100 * ident / pts.length)} %` : "—", "con MMSI (CRC propio o AIS-catcher)"],
    ["Transmisores", fmtInt(vs.length), "MMSI distintos"],
    ["Últimos 15 min", fmtInt(st.bursts_last_15min ?? 0), "ráfagas (en la publicación)"],
    ["Temperatura", st.temp_c_last != null ? `${st.temp_c_last.toFixed(1)} °C` : "—", "AD9363, última lectura"],
    ["Segmentos", `${st.segments_ok ?? 0} OK`, `${st.segments_failed ?? 0} fallidos${st.last_failure ? " · último: " + st.last_failure : ""}`],
    ["Disco libre", st.disk_free_gb != null ? `${st.disk_free_gb} GB` : "—", "en el PC de captura"],
  ];
  $("#tiles").replaceChildren(...tiles.map(([l, v, s]) =>
    el("div", { className: "tile" }, el("div", { className: "label", textContent: l }),
       el("div", { className: "value", textContent: v }), el("div", { className: "sub", textContent: s }))));
}

// ---------------------------------------------------------------- gráficas uPlot
function axes(yLabel) {
  const ink = cssVar("--ink-2"), grid = cssVar("--grid");
  const common = { stroke: ink, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid, width: 1 },
                   font: "12px system-ui, sans-serif", labelFont: "12px system-ui, sans-serif" };
  return [{ ...common }, { ...common, label: yLabel, size: 56 }];
}

function makePlot(target, data, series, yLabel, opts = {}) {
  const box = $(target);
  box.replaceChildren();
  if (!data[0].length) {
    box.append(el("div", { className: "empty", textContent: "Sin datos en este rango" }));
    return;
  }
  const h = box.id === "c-vessel" ? 300 : 220;
  const u = new uPlot({
    width: box.clientWidth, height: h, axes: axes(yLabel),
    scales: { x: { time: true }, ...(opts.scales || {}) },
    cursor: { points: { size: 8 } },
    series: [{ label: "Hora", value: (u, t) => (t == null ? "—" : fmtTime(t)) }, ...series],
  }, data, box);
  S.plots.push(u);
}

const lineSeries = (label, color, unit) => ({
  label, stroke: cssVar(color), width: 2, spanGaps: false, points: { show: false },
  value: (u, v) => (v == null ? "—" : `${Number.isInteger(v) ? v : v.toFixed(1)}${unit}`),
});

function renderSeries(tMin, tMax) {
  const bins = S.summary.bins.filter((b) => b.t >= tMin - S.summary.bin_s && b.t <= tMax);
  const x = bins.map((b) => b.t);
  makePlot("#c-count", [x, bins.map((b) => b.nA), bins.map((b) => b.nB)],
           [lineSeries("Canal A", "--s1", ""), lineSeries("Canal B", "--s2", "")], "ráfagas");
  makePlot("#c-noise", [x, bins.map((b) => b.noiseA), bins.map((b) => b.noiseB)],
           [lineSeries("Canal A", "--s1", " dBFS"), lineSeries("Canal B", "--s2", " dBFS")], "dBFS");
  makePlot("#c-temp", [x, bins.map((b) => b.temp)], [lineSeries("Temperatura", "--s1", " °C")], "°C");
}

function renderVessel(pts, vs) {
  const v = vs.find((r) => r.mmsi === S.sel);
  const sel = pts.filter((r) => r.mmsi === S.sel);
  $("#vessel-note").textContent = v
    ? `${v.name || "(sin nombre)"} · MMSI ${v.mmsi} · ${v.cls || "clase desconocida"}`
      + (v.dist_km != null ? ` · ${v.dist_km.toFixed(2)} km` : "")
      + ` · ${fmtInt(v.n)} tramas · mediana ${fmtDb(v.p_med)} dBFS (p10–p90 ${fmtDb(v.p10)} … ${fmtDb(v.p90)})`
    : "Elige un transmisor (los fijos —estación base, AtoN— son los mejores para ver la propagación en el tiempo).";
  const x = sel.map((r) => r.t);
  const pt = (color) => ({ show: true, size: 5, fill: cssVar(color), stroke: cssVar(color) });
  const sSeries = (label, color) => ({ label, stroke: cssVar(color), paths: () => null, points: pt(color),
                                       value: (u, v) => (v == null ? "—" : `${v.toFixed(1)} dBFS`) });
  makePlot("#c-vessel", [x, sel.map((r) => (r.ch === "A" ? r.p : null)), sel.map((r) => (r.ch === "B" ? r.p : null))],
           [sSeries("Canal A", "--s1"), sSeries("Canal B", "--s2")], "dBFS");
}

// Potencia mediana frente a distancia (SVG: eje x logarítmico, barra p10–p90)
function renderDistance(vs) {
  const box = $("#c-dist");
  box.replaceChildren();
  // Las AtoN (MMSI 99…) de esta zona son virtuales: las emite la estación base, su posición no es el transmisor
  const d = vs.filter((v) => v.dist_km != null && v.dist_km > 0.01 && !v.mmsi.startsWith("99"));
  if (!d.length) { box.append(el("div", { className: "empty", textContent: "Sin posiciones en este rango" })); return; }
  const W = box.clientWidth, H = 210, m = { l: 56, r: 12, t: 22, b: 34 };
  const xs = d.map((v) => Math.log10(v.dist_km));
  const x0 = Math.floor(Math.min(...xs) * 2) / 2, x1 = Math.ceil(Math.max(...xs) * 2) / 2 || x0 + 0.5;
  const y0 = Math.floor((Math.min(...d.map((v) => v.p10)) - 2) / 10) * 10, y1 = Math.ceil((Math.max(...d.map((v) => v.p90)) + 2) / 10) * 10;
  const X = (lx) => m.l + (lx - x0) / Math.max(x1 - x0, 0.5) * (W - m.l - m.r);
  const Y = (p) => m.t + (y1 - p) / Math.max(y1 - y0, 10) * (H - m.t - m.b);
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", W); svg.setAttribute("height", H); svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Potencia mediana de cada transmisor frente a su distancia");
  const add = (tag, attrs, text) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    svg.append(e); return e;
  };
  const ink = cssVar("--ink-2"), grid = cssVar("--grid"), surf = cssVar("--surface");
  for (let p = y0; p <= y1; p += 10) {
    add("line", { x1: m.l, x2: W - m.r, y1: Y(p), y2: Y(p), stroke: grid });
    add("text", { x: m.l - 6, y: Y(p) + 4, "text-anchor": "end", fill: ink, "font-size": 12 }, p);
  }
  for (const k of [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100]) {
    const lx = Math.log10(k);
    if (lx < x0 - 1e-9 || lx > x1 + 1e-9) continue;
    add("line", { x1: X(lx), x2: X(lx), y1: m.t, y2: H - m.b, stroke: grid });
    add("text", { x: X(lx), y: H - m.b + 16, "text-anchor": "middle", fill: ink, "font-size": 12 }, k);
  }
  add("text", { x: W - m.r, y: H - 4, "text-anchor": "end", fill: ink, "font-size": 12 }, "distancia (km, log)");
  add("text", { x: 12, y: m.t - 10, fill: ink, "font-size": 12 }, "dBFS");
  // Leyenda (siempre: hay varios grupos), en HTML encima del gráfico
  box.append(el("div", { className: "legend" }, ...GROUPS.filter((g) => d.some((v) => groupOf(v.cls) === g))
    .map((g) => el("span", {}, el("span", { className: "key", style: `background:${cssVar(g.color)}` }), g.label))));
  for (const v of d) {
    const c = cssVar(groupOf(v.cls).color), cx = X(Math.log10(v.dist_km));
    add("line", { x1: cx, x2: cx, y1: Y(v.p10), y2: Y(v.p90), stroke: c, "stroke-width": 2, "stroke-opacity": 0.35, "stroke-linecap": "round" });
    const dot = add("circle", { cx, cy: Y(v.p_med), r: 4.5, fill: c, stroke: surf, "stroke-width": 2 });
    const hit = add("circle", { cx, cy: Y(v.p_med), r: 12, fill: "transparent", tabindex: 0, style: "cursor:pointer" });
    const show = (ev) => tip(ev, [[`${fmtDb(v.p_med)} dBFS`, `${v.name || v.mmsi} · ${v.dist_km.toFixed(2)} km`],
                                  [`${fmtDb(v.p10)} … ${fmtDb(v.p90)}`, "p10–p90"], [fmtInt(v.n), "tramas"]]);
    hit.addEventListener("pointermove", show);
    hit.addEventListener("focus", (ev) => show({ clientX: dot.getBoundingClientRect().x, clientY: dot.getBoundingClientRect().y }));
    hit.addEventListener("pointerleave", () => ($("#tip").hidden = true));
    hit.addEventListener("blur", () => ($("#tip").hidden = true));
    hit.addEventListener("click", () => selectVessel(v.mmsi));
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

// ---------------------------------------------------------------- mapa
function seqColor(p, lo, hi) {
  const ramp = cssVar("--seq").split(",").map((s) => s.trim());
  const k = hi > lo ? Math.round((p - lo) / (hi - lo) * (ramp.length - 1)) : ramp.length - 1;
  return ramp[Math.max(0, Math.min(ramp.length - 1, k))];
}

function renderMap(vs) {
  const rx = S.summary.receiver || {};
  if (!S.map) {
    S.map = L.map("map", { scrollWheelZoom: false });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
                { maxZoom: 18, attribution: "© OpenStreetMap" }).addTo(S.map);
    S.layer = L.layerGroup().addTo(S.map);
  }
  S.layer.clearLayers();
  const d = vs.filter((v) => v.lat != null && v.lon != null);
  const ps = d.map((v) => v.p_med);
  const lo2 = Math.min(...ps), hi2 = Math.max(...ps);
  // Fijar la vista ANTES de añadir capas
  const pts = d.map((v) => [v.lat, v.lon]);
  if (rx.lat != null) pts.push([rx.lat, rx.lon]);
  if (pts.length) S.map.fitBounds(L.latLngBounds(pts).pad(0.1), { maxZoom: 15 });
  if (rx.lat != null) {
    L.circleMarker([rx.lat, rx.lon], { radius: 7, color: cssVar("--surface"), weight: 2, fillColor: cssVar("--ink"), fillOpacity: 1 })
      .bindTooltip(el("div", { textContent: `Receptor · ${rx.name || ""}` })).addTo(S.layer);
  }
  for (const v of d.sort((a, b) => a.p_med - b.p_med)) {
    L.circleMarker([v.lat, v.lon], { radius: 7, color: cssVar("--surface"), weight: 2,
                                     fillColor: seqColor(v.p_med, lo2, hi2), fillOpacity: 1 })
      .bindTooltip(el("div", {}, el("b", { textContent: `${fmtDb(v.p_med)} dBFS` }),
                      el("div", { textContent: `${v.name || "MMSI " + v.mmsi} · ${v.cls}` }),
                      el("div", { textContent: v.dist_km != null ? `${v.dist_km.toFixed(2)} km · ${fmtInt(v.n)} tramas` : "" })))
      .on("click", () => selectVessel(v.mmsi)).addTo(S.layer);
  }
  const ramp = cssVar("--seq").split(",").map((s) => s.trim());
  $("#map-legend").replaceChildren(
    el("span", { textContent: d.length ? `${lo2.toFixed(0)} dBFS` : "" }),
    el("span", { className: "bar" }, ...ramp.map((c) => el("span", { style: `background:${c}` }))),
    el("span", { textContent: d.length ? `${hi2.toFixed(0)} dBFS` : "" }),
    el("span", { textContent: " · ● negro = receptor" }));
}

// ---------------------------------------------------------------- tablas
const COLS = [
  ["mmsi", "MMSI"], ["name", "Nombre"], ["cls", "Clase"], ["n", "Tramas", 1], ["nA", "A", 1], ["nB", "B", 1],
  ["p_med", "P mediana (dBFS)", 1], ["p10", "p10", 1], ["p90", "p90", 1], ["dist_km", "Distancia (km)", 1], ["last", "Última", 1],
];

function renderTable(vs) {
  const { k, dir } = S.sort;
  vs = [...vs].sort((a, b) => {
    const x = a[k] ?? -Infinity, y = b[k] ?? -Infinity;
    return (x > y ? 1 : x < y ? -1 : 0) * dir;
  });
  const head = el("tr", {}, ...COLS.map(([key, label, num]) => {
    const th = el("th", { className: num ? "num" : "", textContent: label + (key === k ? (dir > 0 ? " ▲" : " ▼") : "") });
    th.addEventListener("click", () => { S.sort = { k: key, dir: key === k ? -dir : (num ? -1 : 1) }; render(); });
    return th;
  }));
  const body = vs.map((v) => {
    const tr = el("tr", { className: v.mmsi === S.sel ? "sel" : "" });
    for (const [key, , num] of COLS) {
      let val = v[key];
      if (key === "cls") {
        const td = el("td", {}, el("span", { className: "key", style: `background:${cssVar(groupOf(val).color)}` }), val || "—");
        tr.append(td); continue;
      }
      if (key === "last") val = fmtTime(val);
      else if (["p_med", "p10", "p90"].includes(key)) val = fmtDb(val);
      else if (key === "dist_km") val = val == null ? "—" : val.toFixed(2);
      else if (typeof val === "number") val = fmtInt(val);
      tr.append(el("td", { className: num ? "num" : "", textContent: val || "—" }));
    }
    tr.addEventListener("click", () => selectVessel(v.mmsi));
    return tr;
  });
  $("#vessels").replaceChildren(el("thead", {}, head), el("tbody", {}, ...body));
}

function renderDownloads() {
  const base = `data/${S.camp}/`;
  const rows = [...S.summary.segments].reverse().map((s) => {
    const links = el("td");
    if (s.raw) {
      for (const [suf, lab] of [["_merged.csv.gz", "merged"], ["_aiscatcher.csv.gz", "aiscatcher"], ["_meta.json", "meta"]]) {
        links.append(el("a", { href: `${base}raw/${s.seg}${suf}`, textContent: lab, download: "" }), " ");
      }
    } else links.textContent = "en curso (se publica al cerrar el segmento)";
    return el("tr", {}, el("td", { textContent: s.seg }),
              el("td", { textContent: s.start_utc ? fmtTime(Date.parse(s.start_utc) / 1000) : "—" }),
              el("td", { className: "num", textContent: s.seconds ? `${(s.seconds / 60).toFixed(0)} min` : "—" }),
              el("td", { className: "num", textContent: fmtInt(s.bursts) }), links);
  });
  const head = el("tr", {}, ...["Segmento", "Inicio", "Duración", "Ráfagas", "Archivos"].map((h, i) =>
    el("th", { textContent: h, className: i === 2 || i === 3 ? "num" : "" })));
  $("#downloads").replaceChildren(el("thead", {}, head), el("tbody", {}, ...rows));
}

// ---------------------------------------------------------------- orquestación
function selectVessel(mmsi) {
  S.sel = mmsi;
  $("#vessel").value = mmsi;
  render();
  $("#c-vessel").scrollIntoView({ behavior: "smooth", block: "center" });
}

function render() {
  S.plots.forEach((u) => u.destroy());
  S.plots = [];
  const [tMin, tMax] = rangeBounds();
  const pts = S.pts.filter((r) => r.t >= tMin && r.t <= tMax);
  const vs = vesselStats(pts);
  if (!S.sel || !vs.some((v) => v.mmsi === S.sel)) {
    // Por defecto: el transmisor fijo con más tramas (o el que más tenga)
    const fixed = vs.filter((v) => groupOf(v.cls).key === "F").sort((a, b) => b.n - a.n);
    S.sel = (fixed[0] || [...vs].sort((a, b) => b.n - a.n)[0] || {}).mmsi || null;
  }
  const opts = [...vs].sort((a, b) => b.n - a.n).map((v) =>
    el("option", { value: v.mmsi, textContent: `${v.name || v.mmsi} (${fmtInt(v.n)})` }));
  $("#vessel").replaceChildren(...opts);
  if (S.sel) $("#vessel").value = S.sel;
  renderStatus();
  renderTiles(pts, vs);
  renderVessel(pts, vs);
  renderSeries(tMin, tMax);
  renderDistance(vs);
  renderMap(vs);
  renderTable(vs);
  renderDownloads();
}

async function load(name) {
  document.body.style.opacity = 0.6;          // se mantiene lo dibujado mientras recarga
  try {
    await loadCampaign(name);
    render();
  } catch (e) {
    $("#subtitle").textContent = `Error cargando datos: ${e.message}`;
  } finally {
    document.body.style.opacity = 1;
  }
}

async function init() {
  let camps = [];
  try { camps = await getJSON("data/campaigns.json"); } catch { /* sin datos aún */ }
  if (!camps.length) { $("#subtitle").textContent = "Todavía no hay campañas publicadas."; return; }
  $("#campaign").replaceChildren(...camps.map((c) => el("option", { value: c.name, textContent: c.name })));
  const want = new URLSearchParams(location.search).get("c");
  const name = camps.some((c) => c.name === want) ? want : camps[0].name;
  $("#campaign").value = name;
  $("#campaign").addEventListener("change", (e) => { S.sel = null; load(e.target.value); });
  $("#vessel").addEventListener("change", (e) => { S.sel = e.target.value; render(); });
  $("#reload").addEventListener("click", () => load(S.camp));
  for (const b of document.querySelectorAll("#range button")) {
    b.addEventListener("click", () => {
      document.querySelectorAll("#range button").forEach((x) => x.classList.toggle("on", x === b));
      S.range = b.dataset.r;
      render();
    });
  }
  let rt;
  addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(render, 200); });
  setInterval(() => load(S.camp), 5 * 60 * 1000);    // los datos se publican cada 15 min
  await load(name);
}

init();
