// Dashboard Pluto-AIS: lee data/ (generado por plutoais.publish).
// Pestaña "Mapa": trayectos de barcos en movimiento sobre satélite, con la potencia de cada trama.
// Pestaña "Mar y meteorología": boya, perfil del modelo, refracción, radiosondeos y METAR del día.
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

// Alcance teórico (mismas fórmulas que plutoais/horizonte.py; parámetros en status.propagacion):
//  ruptura de dos rayos d_b = 4·h_t·h_r/λ y horizonte radioeléctrico d = √(2·k·R·h). Alturas s.n.m.; k opcional (del día).
const C_LUZ = 299792458, R_TIERRA_M = 6371e3;
const horizKm = (h, k) => Math.sqrt(2 * k * R_TIERRA_M * h) / 1000;
function reach(catKey, k) {
  const p = (S.status || {}).propagacion;
  if (!p) return null;
  const ht = p.tx_altura_m[catKey] ?? p.tx_altura_m.other, hr = p.rx_altura_m, kk = k ?? p.k_estandar;
  return { ht, hr, k: kk, kStd: p.k_estandar, ruptura: (4 * ht * hr * p.freq_hz) / C_LUZ / 1000,
           hTx: horizKm(ht, kk), hRx: horizKm(hr, kk), los: horizKm(ht, kk) + horizKm(hr, kk), prov: !p.rx_altura_verificada };
}
const medianOf = (a) => { const v = a.filter((x) => x != null).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
// Alcance para las tramas de UN barco (categoría por su tipo AIS, k mediano de sus tramas si hay entorno)
function reachOfRows(rows) {
  if (!rows.length) return null;
  const sh = shipInfo(rows[0].mmsi);
  if (kindOf(sh.class) !== "ship") return null;              // estación base / AtoN: altura desconocida
  return reach(catOf(sh.type).k, medianOf(rows.map((r) => (envOf(r) || {}).k)));
}
const reachNote = (rc) => `h_tx ${rc.ht} m, h_rx ${rc.hr} m s.n.m.${rc.prov ? " (provisional)" : ""}`;

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
            paths: [], shipPaths: [], meteo: new Map(), meteoMonths: new Map(), env: new Map(), envDays: new Map(),
            atm: new Map() };

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
  const num = new Set(["t", "lat", "lon", "sog", "cog", "dist_km", "p", "snr", "mov", "p_own"]);
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

// Entorno de cada trama (plutoais.entorno, diario): mar, agua, aire y refracción en su posición e instante
const ENV_COLS = ["hm0_m", "costa_hm0_m", "costa_tp_s", "costa_tm02_s", "costa_tm0z_s", "costa_dir_media_deg",
  "costa_dir_pico_deg", "costa_swell_hm0_m", "puerto_hm0_m", "corr_vel_ms", "corr_dir_deg", "temp_agua_c",
  "salinidad_psu", "nivel_m", "viento_ms", "viento_dir_deg", "rafaga_ms", "presion_hpa", "temp_aire_c", "humedad_pct",
  "radiacion_wm2", "nubosidad_pct", "n_sup", "dndh_1km", "k", "dt_mar_aire_c", "fuente_oleaje", "fuente_corr"];
const envKey = (r) => `${(+r.t).toFixed(2)}|${r.mmsi}|${r.ch}`;
const envOf = (r) => S.env.get(envKey(r));
async function ensureEnv(days) {
  const recent = new Date(Date.now() - 3 * 86400e3).toISOString().slice(0, 10);
  await Promise.all(days.filter(Boolean).map(async (d) => {
    if (S.envDays.get(d) && d < recent) return;                 // días recientes: se refrescan (FC → HC)
    try {
      const r = await fetch(`${base()}entorno/${d}.csv.gz?v=${Date.now()}`);
      if (!r.ok) { S.envDays.set(d, false); return; }
      const txt = await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text();
      const lines = txt.split("\n"), head = lines[0].split(",");
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i]) continue;
        const v = lines[i].split(","), o = {};
        head.forEach((h, k) => { o[h] = h === "mmsi" || h === "ch" || h.startsWith("fuente") ? v[k] : (v[k] === "" ? null : +v[k]); });
        S.env.set(envKey(o), o);
      }
      S.envDays.set(d, true);
    } catch { S.envDays.set(d, false); }
  }));
}
// Atmósfera del día (data/meteo/atm/<día>.json): perfil horario del modelo, radiosondeos, METAR
async function ensureAtm(day) {
  if (!day) return;
  const recent = new Date(Date.now() - 3 * 86400e3).toISOString().slice(0, 10);
  if (S.atm.has(day) && S.atm.get(day) && day < recent) return;
  S.atm.set(day, await getJSON(`data/meteo/atm/${day}.json`).catch(() => null));
}
// Valor horario del JSON de atmósfera interpolado al instante t (las magnitudes que no van por celda)
function atmAt(t, key) {
  const H = ((S.atm.get(new Date(t * 1000).toISOString().slice(0, 10)) || {}).horario) || [];
  const pts = H.map((h) => [utcT(h.utc), h[key]]).filter(([, v]) => v != null);
  if (!pts.length) return null;
  let i = pts.findIndex(([ht]) => ht >= t);
  if (i === -1) return pts[pts.length - 1][1];
  if (i === 0) return pts[0][1];
  const [t0, v0] = pts[i - 1], [t1, v1] = pts[i];
  return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
}
const dayOfT = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const refrClass = (g) => (g == null ? "—" : g > 0 ? "subrefracción" : g >= -79 ? "normal" : g >= -157 ? "superrefracción" : "conducto");
const fmtN = (v, nd = 1, unit = "") => (v == null || Number.isNaN(v) ? "—" : `${(+v).toFixed(nd)}${unit}`);

// Flechas de dirección sobre el trayecto elegido. Todas se dibujan HACIA DÓNDE VA el flujo (convención de
// las flechas de viento en los mapas): oleaje y viento se dan "de dónde vienen" → se giran 180°.
// Longitud según la intensidad (entre lmin y lmax px). Cada tipo se puede ocultar; la densidad se elige.
const ARROWS = [
  { k: "wave", label: "Oleaje", color: "#4da3ff", def: true,
    dir: (e) => (e.costa_dir_media_deg == null ? null : (e.costa_dir_media_deg + 180) % 360),
    mag: (e) => e.hm0_m, max: 2,
    text: (e) => `Oleaje: Hm0 ${fmtN(e.hm0_m, 2, " m")}, viene del ${fmtN(e.costa_dir_media_deg, 0, "°")}` },
  { k: "curr", label: "Corriente", color: "#2ee6c5", def: true,
    dir: (e) => e.corr_dir_deg, mag: (e) => e.corr_vel_ms, max: 0.5,
    text: (e) => `Corriente: ${fmtN(e.corr_vel_ms == null ? null : e.corr_vel_ms * 100, 1, " cm/s")} hacia ${fmtN(e.corr_dir_deg, 0, "°")}` },
  { k: "wind", label: "Viento", color: "#ff6fd8", def: true,
    dir: (e) => (e.viento_dir_deg == null ? null : (e.viento_dir_deg + 180) % 360),
    mag: (e) => e.viento_ms, max: 15,
    text: (e) => `Viento: ${fmtN(e.viento_ms, 1, " m/s")} del ${fmtN(e.viento_dir_deg, 0, "°")}` },
  { k: "cog", label: "Rumbo del barco", color: "#f2f2f2", def: false,
    dir: (e, r) => r.cog, mag: (e, r) => r.sog, max: 15,
    text: (e, r) => `Rumbo del barco: ${fmtN(r.cog, 0, "°")} a ${fmtN(r.sog, 1, " kn")}` },
];
const store = {                          // preferencias de este navegador (si el almacenamiento falla, no pasa nada)
  get(k, d) { try { const v = localStorage.getItem("pluto-ais:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("pluto-ais:" + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};
const arrowOn = Object.fromEntries(ARROWS.map((a) => [a.k, store.get("arrow-" + a.k, a.def)]));
let arrowDensity = store.get("arrow-density", 20);
let showPoints = store.get("show-points", false);      // puntos de potencia (color = dBFS); por defecto, solo línea + flechas

function arrowSVG(color, len, rot) {
  const L = Math.round(len), h = 6;
  const sz = 2 * L + 4;
  const path = `M0,0 L0,${-L + h} M${-h / 1.6},${-L + h} L0,${-L} L${h / 1.6},${-L + h} Z`;
  return `<svg width="${sz}" height="${sz}" viewBox="${-sz / 2} ${-sz / 2} ${sz} ${sz}"><g transform="rotate(${rot})">`
    + `<path d="${path}" stroke="#0b0b0b" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round" fill="#0b0b0b"/>`
    + `<path d="${path}" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" fill="${color}"/></g></svg>`;
}

function renderArrows(hl) {
  const box = $("#arrow-ctl");
  box.hidden = !hl.length;
  const noEnv = hl.length > 0 && !hl.some((r) => envOf(r));
  $("#env-banner").hidden = !noEnv;
  if (noEnv) {
    const days = [...S.envDays].filter(([, ok]) => ok).map(([d]) => d).sort();
    $("#env-banner").textContent = `Este día todavía no tiene datos de mar, aire y refracción: se calculan cada día a las 06:10 UTC `
      + `(08:10 en España) para el día anterior.${days.length ? ` Días con datos: ${days.join(", ")}.` : ""}`;
  }
  if (!hl.length) return;
  const withEnv = hl.filter((r) => envOf(r));
  const step = Math.max(1, Math.ceil(hl.length / arrowDensity));
  const pick = hl.filter((_, i) => i % step === 0);
  for (const a of ARROWS) {
    if (!arrowOn[a.k]) continue;
    for (const r of pick) {
      const e = envOf(r) || {};
      const d = a.dir(e, r), m = a.mag(e, r);
      if (d == null || m == null || Number.isNaN(d)) continue;
      const len = 12 + 22 * Math.min(1, Math.max(0, m / a.max));
      const sz = 2 * Math.round(len) + 4;
      L.marker([r.lat, r.lon], { icon: L.divIcon({ html: arrowSVG(a.color, len, d), className: "arrow-ic",
                                                    iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2] }),
                                 keyboard: false, zIndexOffset: -100 })
        .bindTooltip(el("div", {}, el("b", { textContent: a.text(e, r) }), el("div", { textContent: fmtTime(r.t) }),
                        el("div", { className: "muted", textContent: "clic: todos los datos del punto" })), { direction: "top" })
        .bindPopup(() => pointCard(r), { maxWidth: 340, minWidth: 260, autoPanPadding: [20, 20] })
        .addTo(S.layer);
    }
  }
  const chips = ARROWS.map((a) => {
    const cb = el("input", { type: "checkbox", checked: arrowOn[a.k], id: "arrow-" + a.k });
    cb.addEventListener("change", () => { arrowOn[a.k] = cb.checked; store.set("arrow-" + a.k, cb.checked); renderMap(); });
    const sw = el("span", { className: "arrow-sw" });
    sw.innerHTML = arrowSVG(a.color, 9, 45);              // SVG generado aquí (sin datos externos)
    return el("label", { className: "chip", htmlFor: "arrow-" + a.k }, cb, sw, a.label);
  });
  const dens = el("input", { type: "range", min: 5, max: 100, step: 5, value: arrowDensity, id: "arrow-density",
                             ariaLabel: "Flechas por tipo" });
  const dl = el("span", { className: "muted", textContent: `${Math.min(arrowDensity, hl.length)} por tipo` });
  dens.addEventListener("input", () => { arrowDensity = +dens.value; dl.textContent = `${Math.min(arrowDensity, hl.length)} por tipo`; });
  dens.addEventListener("change", () => { store.set("arrow-density", arrowDensity); renderMap(); });
  const pcb = el("input", { type: "checkbox", checked: showPoints, id: "show-points" });
  pcb.addEventListener("change", () => { showPoints = pcb.checked; store.set("show-points", showPoints); renderMap(); });
  const pts = el("label", { className: "chip", htmlFor: "show-points" }, pcb, "Puntos de potencia (color = dBFS)");
  box.replaceChildren(el("span", { className: "arrow-title", textContent: "Flechas (hacia dónde va):" }), ...chips,
    el("label", { className: "chip", htmlFor: "arrow-density" }, "densidad", dens, dl),
    pts, el("span", { className: "muted small", textContent: withEnv.length ? "· pincha en una flecha o un punto para ver todos sus datos"
      : "· entorno de este día aún no publicado (solo el rumbo del barco)" }));
}

// Ficha de una trama (popup del mapa): potencia + entorno en su posición e instante
function pointCard(r) {
  const e = envOf(r), m = meteoAt(r.t);
  const card = el("div", { className: "pt-card" });
  const sec = (title, rows) => {
    card.append(el("div", { className: "pt-sec", textContent: title }));
    const tb = el("table");
    for (const [k, v] of rows) tb.append(el("tr", {}, el("th", { textContent: k }), el("td", { textContent: v })));
    card.append(tb);
  };
  const t = (S.ship ? S.shipTrips : S.trips).find((x) => x.trip === r.trip) || {};
  card.append(el("div", { className: "pt-head" }, el("b", { textContent: `${fmt1(r.p)} dBFS` }),
    ` · ${t.name || "MMSI " + r.mmsi} · canal ${r.ch}`));
  sec("Trama", [["Hora", fmtTime(r.t) + ":" + String(new Date(r.t * 1000).getSeconds()).padStart(2, "0")],
    ["SNR", fmtN(r.snr, 1, " dB")], ["Distancia", fmtN(r.dist_km, 2, " km")], ["Velocidad", `${fmtN(r.sog, 1, " kn")} · rumbo ${fmtN(r.cog, 0, "°")}`],
    ["Posición", `${(+r.lat).toFixed(5)}, ${(+r.lon).toFixed(5)} (${r.pos === "f" ? "de la trama" : "interpolada"})`],
    ["Potencia", srcText(r)]]);
  if (!e) {
    card.append(el("p", { className: "pt-none", textContent: S.envDays.get(dayOfT(r.t))
      ? "Sin datos de entorno para esta trama."
      : "Entorno de este día aún no publicado (se calcula cada día a las 06:10 UTC para el día anterior)." }));
  } else {
    const port = e.puerto_hm0_m != null;
    sec("Mar (Puertos del Estado)", [
      ["Altura de ola Hm0", `${fmtN(e.hm0_m, 2, " m")} (${port ? "modelo del puerto" : "modelo costero"})`],
      ["Ola (modelo costero)", fmtN(e.costa_hm0_m, 2, " m")], ["Mar de fondo", fmtN(e.costa_swell_hm0_m, 2, " m")],
      ["Periodo de pico", fmtN(e.costa_tp_s, 1, " s")], ["Periodo medio Tm02 / Tm0z", `${fmtN(e.costa_tm02_s, 1)} / ${fmtN(e.costa_tm0z_s, 1)} s`],
      ["Oleaje viene del", `${fmtN(e.costa_dir_media_deg, 0, "°")} (pico ${fmtN(e.costa_dir_pico_deg, 0, "°")})`]]);
    sec("Agua", [["Corriente", `${fmtN(e.corr_vel_ms == null ? null : e.corr_vel_ms * 100, 1, " cm/s")} hacia ${fmtN(e.corr_dir_deg, 0, "°")}`],
      ["Temperatura", fmtN(e.temp_agua_c, 2, " °C")], ["Salinidad", fmtN(e.salinidad_psu, 2, " psu")],
      ["Nivel del mar (modelo)", fmtN(e.nivel_m, 3, " m")]]);
    sec("Aire (ICON-EU)", [["Viento", `${fmtN(e.viento_ms, 1, " m/s")} del ${fmtN(e.viento_dir_deg, 0, "°")}`], ["Ráfaga", fmtN(e.rafaga_ms, 1, " m/s")],
      ["Temperatura", fmtN(e.temp_aire_c, 1, " °C")], ["Humedad", fmtN(e.humedad_pct, 0, " %")],
      ["Presión", fmtN(e.presion_hpa, 1, " hPa")],
      ["Capa límite (GFS)", fmtN(atmAt(r.t, "capa_limite_m"), 0, " m")], ["Nubes bajas", fmtN(atmAt(r.t, "nubes_bajas_pct"), 0, " %")],
      ["Radiación solar", fmtN(e.radiacion_wm2, 0, " W/m²")], ["Nubosidad", fmtN(e.nubosidad_pct, 0, " %")]]);
    const dt = e.dt_mar_aire_c;
    sec("Refracción (ITU-R P.453)", [["N en superficie", fmtN(e.n_sup, 1, " N")],
      ["dN/dh (0–1 km)", `${fmtN(e.dndh_1km, 1, " N/km")} · ${refrClass(e.dndh_1km)}`], ["Factor k", fmtN(e.k, 3)],
      ["T agua − T aire", `${fmtN(dt, 2, " °C")}${dt == null ? "" : dt > 0 ? " (aire inestable)" : " (aire estable: favorece conductos)"}`]]);
    card.append(el("div", { className: "pt-src", textContent: `Modelos: oleaje ${e.fuente_oleaje || "—"} · corriente ${e.fuente_corr || "—"} (HC = análisis, FC = pronóstico)` }));
  }
  if (m) card.append(el("div", { className: "pt-src", textContent: meteoText(m) }));
  return card;
}

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
                                             ensureMeteo([day]), ensureEnv([day]), ensureAtm(day)]);
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
                                             ensureMeteo(days), ensureEnv(days), ...days.map(ensureAtm)]);
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
  S.reach = L.layerGroup().addTo(S.map);
  L.control.layers({ "Satélite": sat, "Mapa": osm }, { "Alcance teórico (ruptura y horizonte)": S.reach }, { position: "topright" }).addTo(S.map);
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

// Circunferencias teóricas alrededor del receptor para el barco elegido (o un barco "otro" si no hay ninguno)
function renderReach(rx, hl) {
  S.reach.clearLayers();
  if (rx.lat == null) return;
  const rc = hl.length ? reachOfRows(hl) : reach("other");
  if (!rc) return;
  const who = hl.length ? "" : " · barco de referencia (otro, sin elegir)";
  for (const [km, color, text] of [[rc.ruptura, "#ffd166", `Ruptura de dos rayos: ${rc.ruptura.toFixed(2)} km`],
                                   [rc.los, "#4da3ff", `Horizonte radioeléctrico: ${rc.los.toFixed(1)} km (k ${rc.k.toFixed(2)})`]])
    L.circle([rx.lat, rx.lon], { radius: km * 1000, color, weight: 2, dashArray: "8 8", fill: false })
      .bindTooltip(el("div", { textContent: `${text} · ${reachNote(rc)}${who}` }), { sticky: true }).addTo(S.reach);
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
  if (pts.length > 1) S.map.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 16, animate: false });

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
  S.markers = new Map();
  for (const r of hl) {
    const e = envOf(r);
    const mk = L.circleMarker([r.lat, r.lon], { radius: r.pos === "f" ? 6 : 4, color: "#1a1a19", weight: 1.5,
                                     fillColor: rampColor(r.p, lo, hi), fillOpacity: 1 })
      .bindTooltip(el("div", {}, el("b", { textContent: `${fmt1(r.p)} dBFS` }),
        el("div", { textContent: `${fmtTime(r.t)} · canal ${r.ch} · SNR ${fmt1(r.snr)} dB` }),
        el("div", { textContent: `${fmt1(r.dist_km)} km · ${fmt1(r.sog)} kn · posición ${r.pos === "f" ? "trama" : "interp."}` }),
        el("div", { textContent: srcText(r) }),
        el("div", { textContent: e ? `ola ${fmtN(e.hm0_m, 2, " m")} · viento ${fmtN(e.viento_ms, 1, " m/s")} · k ${fmtN(e.k, 2)}` : "" }),
        el("div", { className: "muted", textContent: "clic: todos los datos del punto" })))
      .bindPopup(() => pointCard(r), { maxWidth: 340, minWidth: 260, autoPanPadding: [20, 20] });
    if (showPoints) mk.addTo(S.layer);
    S.markers.set(envKey(r), mk);
  }
  renderArrows(hl);
  renderReach(rx, hl);
  if (rx.lat != null) {
    L.circleMarker([rx.lat, rx.lon], { radius: 7, color: "#ffffff", weight: 2, fillColor: "#0b0b0b", fillOpacity: 1 })
      .bindTooltip(el("div", { textContent: `Receptor · ${rx.name || ""}` })).addTo(S.layer);
  }
  renderFleet();
  $("#map-legend").hidden = !showPoints && hl.length > 0;
  $("#map-legend").replaceChildren(
    el("span", { textContent: `${fmt1(lo)} dBFS` }),
    el("span", { className: "bar" }, ...ramp().map((c) => el("span", { style: `background:${c}` }))),
    el("span", { textContent: `${fmt1(hi)} dBFS` }),
    el("span", { textContent: "· potencia de cada trama, medida por AIS-catcher (marca grande = posición de la propia trama, pequeña = interpolada) · ● negro = receptor" }));
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
    for (const id of ["#c-env-wave", "#c-env-curr", "#c-env-wind", "#c-env-temp", "#c-env-refr", "#c-env-blh", "#c-env-dist"])
      $(id).replaceChildren(el("div", { className: "empty", textContent: "—" }));
    S.ballRows = [];
    moveBall(null);
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
  const rc = reachOfRows(d);
  if (rc) box.firstChild.append(
    el("span", {}, el("span", { className: "key dash", style: "border-color:#d99a00" }),
      `Ruptura de dos rayos ${rc.ruptura.toFixed(2)} km (${reachNote(rc)})`),
    el("span", {}, el("span", { className: "key dash", style: "border-color:#2a78d6" }),
      `Horizonte radioeléctrico ${rc.los.toFixed(1)} km (k ${rc.k.toFixed(2)}${rc.k === rc.kStd ? ", estándar" : ""})`));
  const W = box.clientWidth, H = 240, m = { l: 52, r: 12, t: 22, b: 34 };
  const xs = d.map((r) => r.dist_km), ys = d.map((r) => r.p);
  let x0 = Math.max(0, Math.floor(Math.min(...xs) * 10) / 10 - 0.1);
  const x1 = Math.ceil(Math.max(...xs) * 10) / 10 + 0.1;
  if (rc) x0 = Math.max(0, Math.min(x0, Math.floor(rc.ruptura * 10) / 10 - 0.1));   // la ruptura siempre a la vista
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
  if (rc) [[rc.ruptura, "#d99a00", "ruptura"], [rc.los, "#2a78d6", "horizonte"]].forEach(([v, color, label], i) => {
    const out = v > x1 ? 1 : v < x0 ? -1 : 0, xv = Math.min(Math.max(v, x0), x1);   // fuera de escala: línea en el borde + flecha
    add("line", { x1: X(xv), x2: X(xv), y1: m.t, y2: H - m.b, stroke: color, "stroke-width": 2, "stroke-dasharray": "6 4" });
    const left = out > 0 || X(xv) > W - m.r - 110;                                    // etiqueta a la izquierda si no cabe a la derecha
    const tx = add("text", { x: X(xv) + (left ? -4 : 4), y: m.t + 11 + 14 * i, "text-anchor": left ? "end" : "start", fill: ink, "font-size": 11 },
      `${out < 0 ? "◄ " : ""}${label} ${v.toFixed(v < 10 ? 2 : 1)} km${out > 0 ? " ►" : ""}`);
    tx.style.paintOrder = "stroke"; tx.style.stroke = surf; tx.style.strokeWidth = "3px";
  });
  for (const r of d) {
    const c = cssVar(r.ch === "A" ? "--s1" : "--s2");
    add("circle", { cx: X(r.dist_km), cy: Y(r.p), r: 4, fill: c, stroke: surf, "stroke-width": 1.5 });
    const hit = add("circle", { cx: X(r.dist_km), cy: Y(r.p), r: 10, fill: "transparent" });
    hit.addEventListener("pointermove", (ev) => tip(ev, [[`${fmt1(r.p)} dBFS`, `canal ${r.ch}`],
      [`${r.dist_km.toFixed(3)} km`, fmtTime(r.t)], [`${fmt1(r.snr)} dB`, "SNR"]]));
    hit.addEventListener("pointerleave", () => ($("#tip").hidden = true));
    hit.style.cursor = "pointer";
    hit.addEventListener("click", () => {                 // abre la ficha del punto en el mapa
      const mk = (S.markers || new Map()).get(envKey(r));
      if (mk) { $("#map").scrollIntoView({ behavior: "smooth", block: "center" });
                if (!S.layer.hasLayer(mk)) mk.addTo(S.layer); mk.openPopup(); }
    });
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

function makePlot(target, data, series, yLabel, height = 230, extra = {}) {
  const box = $(target);
  box.replaceChildren();
  if (!data[0].length) { box.append(el("div", { className: "empty", textContent: "Sin datos" })); return; }
  const u = new uPlot({ width: box.clientWidth, height, axes: uplotAxes(yLabel), scales: { x: { time: true } },
                        ...extra, cursor: { points: { size: 8 }, ...(extra.cursor || {}) },
                        series: [{ label: "Hora", value: (u, t) => (t == null ? "—" : fmtTimeS(t)) }, ...series] }, data, box);
  S.plots.push(u);
}

// Gráficas del trayecto con el cursor compartido: la línea vertical se mueve en todas a la vez y una
// pelotita marca en el mapa dónde estaba el barco en ese instante (trama más cercana en el tiempo).
const fmtTimeS = (t) => `${fmtTime(t)}:${String(new Date(t * 1000).getSeconds()).padStart(2, "0")}`;
const tripSync = () => ({ cursor: { sync: { key: "trip", setSeries: false } },
                          hooks: { setCursor: [(u) => moveBall(u.cursor.idx == null ? null : u.data[0][u.cursor.idx])] } });
function moveBall(t) {
  if (!S.map) return;
  const rows = S.ballRows || [];
  if (t == null || !rows.length) { if (S.ball) S.ball.remove(); return; }
  let lo = 0, hi = rows.length - 1;                       // búsqueda binaria de la trama más cercana
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (rows[m].t < t) lo = m; else hi = m; }
  const r = Math.abs(rows[lo].t - t) <= Math.abs(rows[hi].t - t) ? rows[lo] : rows[hi];
  if (!S.ball) S.ball = L.marker([r.lat, r.lon], { icon: L.divIcon({ className: "ball", iconSize: [18, 18], iconAnchor: [9, 9] }),
                                                   interactive: false, keyboard: false, zIndexOffset: 2000 });
  S.ball.setLatLng([r.lat, r.lon]);
  if (!S.map.hasLayer(S.ball)) S.ball.addTo(S.map);
}

// Entorno a lo largo del trayecto (una gráfica por magnitud, mismo eje de tiempo que la potencia)
function renderEnvCharts(rows) {
  const has = rows.some((r) => envOf(r));
  const ids = ["#c-env-wave", "#c-env-curr", "#c-env-wind", "#c-env-temp", "#c-env-refr", "#c-env-blh", "#c-env-dist"];
  const x = rows.map((r) => r.t), E = rows.map((r) => envOf(r) || {});
  const col = (f) => E.map((e, i) => { const v = f(e, rows[i]); return v == null || Number.isNaN(v) ? null : v; });
  const opt = tripSync();
  makePlot("#c-env-dist", [x, col((e, r) => r.dist_km)], [ser("Distancia", "--s1", " km")], "km", 190, opt);
  if (!has) {
    const msg = S.envDays.get(dayOfT(rows.length ? rows[0].t : 0)) === false || !rows.length
      ? "Entorno de este día aún no publicado (se calcula cada día a las 06:10 UTC)" : "Sin datos de entorno";
    for (const id of ids.slice(0, -1)) $(id).replaceChildren(el("div", { className: "empty", textContent: msg }));
    return;
  }
  makePlot("#c-env-wave", [x, col((e) => e.hm0_m), col((e) => e.costa_swell_hm0_m)],
           [ser("Altura de ola", "--s1", " m"), ser("Mar de fondo", "--s2", " m")], "m", 190, opt);
  makePlot("#c-env-curr", [x, col((e) => (e.corr_vel_ms == null ? null : e.corr_vel_ms * 100))],
           [ser("Corriente", "--s1", " cm/s")], "cm/s", 190, opt);
  makePlot("#c-env-wind", [x, col((e) => e.viento_ms), col((e) => e.rafaga_ms)],
           [ser("Viento", "--s1", " m/s"), ser("Ráfaga", "--s2", " m/s")], "m/s", 190, opt);
  makePlot("#c-env-temp", [x, col((e) => e.temp_agua_c), col((e) => e.temp_aire_c)],
           [ser("Agua", "--s1", " °C"), ser("Aire", "--s2", " °C")], "°C", 190, opt);
  makePlot("#c-env-refr", [x, col((e) => e.k)], [ser("Factor k", "--s1", "")], "k", 190, opt);
  makePlot("#c-env-blh", [x, x.map((t) => atmAt(t, "capa_limite_m"))], [ser("Capa límite", "--s1", " m")], "m", 190, opt);
}

function renderTimeChart(rows) {
  const pt = (v) => ({ show: true, size: 6, fill: cssVar(v), stroke: cssVar(v) });
  const ser = (label, v) => ({ label, stroke: cssVar(v), paths: () => null, points: pt(v),
                               value: (u, x) => (x == null ? "—" : `${x.toFixed(1)} dBFS`) });
  makePlot("#c-time", [rows.map((r) => r.t), rows.map((r) => (r.ch === "A" ? r.p : null)), rows.map((r) => (r.ch === "B" ? r.p : null))],
           [ser("Canal A", "--s1"), ser("Canal B", "--s2")], "dBFS", 230, tripSync());
  S.ballRows = rows.filter((r) => r.lat != null);
  renderEnvCharts(rows);
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
// Fuente de la potencia: ac = AIS-catcher (todas las tramas desde 2026-10-02), own = nuestra cadena
const srcText = (r) => (r.src === "ac"
  ? `potencia: AIS-catcher${r.p_own != null ? ` · nuestra: ${fmt1(r.p_own)} dBFS` : " · bajo nuestro umbral de detección"}`
  : `potencia: nuestra cadena${r.src === "own" ? " (AIS-catcher no la tiene)" : ""}`);
const CSV_COLS = ["utc", "mmsi", "nombre", "trip", "ch", "lat", "lon", "pos", "sog_kn", "cog", "dist_km", "power_dbfs", "snr_db",
                  "power_src", "power_own_dbfs",
                  "msg_type", ...METEO_COLS.map((c) => "boya_" + c), ...ENV_COLS];
function downloadCSV(rows, name) {
  const names = new Map([...S.trips, ...S.shipTrips].map((t) => [t.trip, t.name]));
  const esc = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = [CSV_COLS.join(",")].concat(rows.map((r) => [new Date(r.t * 1000).toISOString(), r.mmsi, names.get(r.trip) || "",
    r.trip, r.ch, r.lat, r.lon, r.pos, r.sog, r.cog, r.dist_km, r.p, r.snr, r.src || "own", r.p_own, r.msg,
    ...METEO_COLS.map((c) => (meteoAt(r.t) || {})[c]), ...ENV_COLS.map((c) => (envOf(r) || {})[c])].map(esc).join(",")));
  const a = el("a", { href: URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" })), download: name });
  document.body.append(a); a.click(); a.remove();
}

// ---------------------------------------------------------------- pestaña Mar y meteorología
// Series con relojes distintos (modelo cada hora, boya cada 30 min, METAR…) → un eje común con huecos
function joinSeries(list) {
  const xs = [...new Set(list.flatMap(([t]) => t))].sort((a, b) => a - b);
  const idx = new Map(xs.map((t, i) => [t, i]));
  return [xs, ...list.map(([t, v]) => { const o = new Array(xs.length).fill(null); t.forEach((ti, k) => { o[idx.get(ti)] = v[k] ?? null; }); return o; })];
}
const ser = (label, color, unit, extra = {}) => ({ label, stroke: color.startsWith("--") ? cssVar(color) : color, width: 2,
  spanGaps: true, points: { show: false }, value: (u, y) => (y == null ? "—" : `${Math.abs(y) >= 100 ? y.toFixed(0) : y.toFixed(Math.abs(y) < 10 ? 2 : 1)}${unit}`), ...extra });
const dots = (label, color, unit) => ser(label, color, unit, { paths: () => null, points: { show: true, size: 9, fill: cssVar(color), stroke: cssVar(color) } });
const dashed = (label, unit) => ser(label, "--muted", unit, { width: 1, dash: [5, 5] });
const utcT = (s) => Date.parse(s.length <= 16 ? s + ":00Z" : s) / 1000;

function renderMeteo() {
  S.plots.forEach((u) => u.destroy());
  S.plots = [];
  const day = S.day, atm = S.atm.get(day);
  const d0 = Date.parse(`${day}T00:00:00Z`) / 1000;
  const boya = [...S.meteo.values()].filter((r) => r.t >= d0 && r.t < d0 + 86400).sort((a, b) => a.t - b.t);
  const H = atm ? atm.horario : [];
  const hx = H.map((h) => utcT(h.utc));
  const met = atm ? atm.metar : [];
  const lelc = met.filter((m) => m.estacion === "LELC"), lemi = met.filter((m) => m.estacion === "LEMI");
  const sondes = atm ? atm.radiosondeos : [];
  const bt = boya.map((r) => r.t);
  const envDay = [...S.env.values()].filter((e) => dayOfT(e.t) === day);
  const med = (a) => { const v = a.filter((x) => x != null).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
  const vals = (k) => H.map((h) => h[k]).filter((v) => v != null);

  $("#meteo-note").textContent = atm
    ? `Día ${day} (UTC). Modelo: ${atm.modelo}, perfil en ${atm.punto_ref.join(", ")}; radiosondeo de Murcia (08430, ~50 km tierra adentro);`
      + ` METAR de San Javier (LELC) y Murcia (LEMI); boya de Cartagena (PORTUS 1612).`
      + (atm.avisos && atm.avisos.length ? `\nAvisos: ${atm.avisos.join(" · ")}` : "")
    : `Día ${day}: la atmósfera (modelo, radiosondeos, METAR) aún no está publicada; se calcula cada día a las 06:10 UTC para el día anterior.`
      + (boya.length ? " Abajo, solo la boya de Cartagena." : "");

  const ducts = sondes.flatMap((s) => s.conductos.map((c) => ({ ...c, s })));
  const big = ducts.filter((c) => c.espesor_m >= 100);
  const tiles = [
    ["Oleaje (boya)", boya.length ? `${fmt1(Math.max(...boya.map((r) => r.hm0_m ?? 0)))} m` : "—",
      boya.length ? `Hm0 máx. · Tp mediana ${fmt1(med(boya.map((r) => r.tp_s)))} s` : "sin datos de la boya"],
    ["Viento (boya)", boya.length ? `${fmt1(med(boya.map((r) => r.wind_ms)))} m/s` : "—", "mediana del día"],
    ["Agua (modelo)", envDay.length ? `${fmtN(med(envDay.map((e) => e.temp_agua_c)), 1, " °C")}` : "—",
      envDay.length ? `mediana en las tramas · corriente ${fmtN(med(envDay.map((e) => (e.corr_vel_ms == null ? null : e.corr_vel_ms * 100))), 0, " cm/s")}` : "sin tramas con entorno"],
    ["dN/dh 0–1 km", vals("dndh_1km").length ? `${fmt1(med(vals("dndh_1km")))} N/km` : "—",
      vals("dndh_1km").length ? `mediana · mín. ${fmt1(Math.min(...vals("dndh_1km")))} (−40 = estándar)` : ""],
    ["Factor k", vals("k").length ? fmtN(med(vals("k")), 2) : "—",
      vals("k").length ? `${fmtN(Math.min(...vals("k")), 2)}–${fmtN(Math.max(...vals("k")), 2)} (4/3 = estándar)` : ""],
    ["Conductos (sondeo)", sondes.length ? String(ducts.length) : "—",
      sondes.length ? (big.length ? `${big.length} de ≥ 100 m (pueden atrapar 162 MHz)` : "ninguno ≥ 100 m: no atrapan a 162 MHz") : "sin radiosondeo"],
  ];
  $("#m-tiles").replaceChildren(...tiles.map(([l, v, s2]) => el("div", { className: "tile" },
    el("div", { className: "label", textContent: l }), el("div", { className: "value", textContent: v }),
    el("div", { className: "sub", textContent: s2 }))));

  const sonde = (k) => [sondes.map((s) => utcT(s.lanzamiento_utc)), sondes.map((s) => s[k])];
  makePlot("#c-wave", joinSeries([[bt, boya.map((r) => r.hm0_m)], [bt, boya.map((r) => r.hmax_m)]]),
           [ser("Hm0", "--s1", " m"), ser("Hmax", "--s2", " m")], "m", 220);
  makePlot("#c-tp", joinSeries([[bt, boya.map((r) => r.tp_s)], [bt, boya.map((r) => r.tm02_s)]]),
           [ser("Tp", "--s1", " s"), ser("Tm02", "--s2", " s")], "s", 220);
  makePlot("#c-wdir", joinSeries([[bt, boya.map((r) => r.wave_dir_deg)], [bt, boya.map((r) => r.wind_dir_deg)]]),
           [dots("Oleaje (viene del)", "--s1", "°"), dots("Viento (viene del)", "--s2", "°")], "grados", 220);
  makePlot("#c-wind", joinSeries([[bt, boya.map((r) => r.wind_ms)], [hx, H.map((h) => h.viento_ms)],
                                  [lelc.map((m) => utcT(m.utc)), lelc.map((m) => (m.viento_kn == null ? null : m.viento_kn * 0.5144))]]),
           [ser("Boya", "--s1", " m/s"), ser("Modelo", "--s2", " m/s"), ser("San Javier", "--s3", " m/s")], "m/s", 220);
  makePlot("#c-dndh", joinSeries([[hx, H.map((h) => h.dndh_1km)], sonde("dndh_1km"), [hx, hx.map(() => -79)], [hx, hx.map(() => -157)]]),
           [ser("Modelo (0–1 km)", "--s1", " N/km"), dots("Radiosondeo", "--s2", " N/km"),
            dashed("super (−79)", ""), dashed("conducto (−157)", "")], "N/km", 220);
  makePlot("#c-k", joinSeries([[hx, H.map((h) => h.k)], sonde("k"), [hx, hx.map(() => 4 / 3)]]),
           [ser("Modelo", "--s1", ""), dots("Radiosondeo", "--s2", ""), dashed("estándar (4/3)", "")], "k", 220);
  makePlot("#c-nsup", [hx, H.map((h) => h.n_sup)], [ser("N en superficie", "--s1", " N")], "N", 220);
  makePlot("#c-tair", joinSeries([[hx, H.map((h) => h.t2m_c)], [hx, H.map((h) => h.td2m_c)], [bt, boya.map((r) => r.air_temp_c)],
                                  [lelc.map((m) => utcT(m.utc)), lelc.map((m) => m.t_c)]]),
           [ser("T aire (modelo)", "--s1", " °C"), ser("Rocío (modelo)", "--s3", " °C"), ser("T aire (boya)", "--s2", " °C"),
            dots("T San Javier", "--ink-2", " °C")], "°C", 220);
  makePlot("#c-press", joinSeries([[hx, H.map((h) => h.p_sup_hpa)], [bt, boya.map((r) => r.pressure_mb)],
                                   [lelc.map((m) => utcT(m.utc)), lelc.map((m) => m.p_hpa)]]),
           [ser("Modelo", "--s1", " hPa"), ser("Boya", "--s2", " hPa"), dots("San Javier (QNH)", "--s3", " hPa")], "hPa", 220);
  makePlot("#c-rad", [hx, H.map((h) => h.radiacion_wm2)], [ser("Radiación solar", "--s1", " W/m²")], "W/m²", 220);
  makePlot("#c-cloud", [hx, H.map((h) => h.nubosidad_pct), H.map((h) => h.nubes_bajas_pct)],
           [ser("Nubosidad total", "--s1", " %"), ser("Nubes bajas", "--s2", " %")], "%", 220);
  makePlot("#c-blh", [hx, H.map((h) => h.capa_limite_m)], [ser("Capa límite (GFS)", "--s1", " m")], "m", 220);
  renderSonde(sondes);
  renderMetar(met);
  renderReachTable(med(vals("k")));
}

// Tabla de alcance teórico por categoría de barco (k estándar y k mediano del día si hay atmósfera publicada)
function renderReachTable(kDay) {
  const tab = $("#t-reach"), p = (S.status || {}).propagacion;
  if (!p) { tab.replaceChildren(); $("#reach-note").textContent = "Sin parámetros de propagación en el estado publicado."; return; }
  const rx = reach("other", kDay), k1 = horizKm(rx.hr, 1), kS = horizKm(rx.hr, p.k_estandar);
  $("#reach-note").textContent = `Receptor a ${rx.hr} m s.n.m.${rx.prov ? " (provisional: confirmar la altura real de la antena)" : ""}; `
    + `λ = ${(C_LUZ / p.freq_hz).toFixed(3)} m. Horizonte del receptor: ${fmt1(k1)} km (k = 1), ${fmt1(kS)} km (k = ${p.k_estandar.toFixed(2)})`
    + (kDay ? `, ${fmt1(rx.hRx)} km (k = ${kDay.toFixed(2)}, mediana del día).` : ".")
    + " Alturas de las antenas de los barcos: valores típicos por categoría (AIS no las transmite).";
  const head = ["Categoría", "h antena (m)", "Ruptura (km)", "Horizonte del barco (km)", "Alcance k = 1 (km)",
                `Alcance k = ${p.k_estandar.toFixed(2)} (km)`, ...(kDay ? [`Alcance k = ${kDay.toFixed(2)} (km)`] : [])];
  const rows = CATS.map((c) => {
    const a = reach(c.k, p.k_estandar), b = reach(c.k, 1), d = kDay ? reach(c.k, kDay) : null;
    return [c.label, a.ht, a.ruptura.toFixed(2), a.hTx.toFixed(1), b.los.toFixed(1), a.los.toFixed(1), ...(d ? [d.los.toFixed(1)] : [])];
  });
  tab.replaceChildren(el("thead", {}, el("tr", {}, ...head.map((h) => el("th", { textContent: h })))),
    el("tbody", {}, ...rows.map((r) => el("tr", {}, ...r.map((v) => el("td", { textContent: String(v) }))))));
}

// Perfiles M(h) de los radiosondeos (0–3 km) con los conductos sombreados
function renderSonde(sondes) {
  const v = $("#sonde-var").value;                  // "m" (modificada) o "n"
  const box = $("#c-sonde");
  box.replaceChildren();
  if (!sondes.length) { box.append(el("div", { className: "empty", textContent: "Sin radiosondeos este día" })); $("#t-ducts").replaceChildren(); return; }
  const cols = ["--s1", "--s2"];
  box.append(el("div", { className: "legend" }, ...sondes.map((s, i) =>
    el("span", {}, el("span", { className: "key", style: `background:${cssVar(cols[i % 2])}` }),
       `${s.nominal_utc.slice(11, 16)} UTC (lanzado ${s.lanzamiento_utc.slice(11, 16)})`))));
  const W = box.clientWidth, Hh = 380, m = { l: 52, r: 12, t: 10, b: 34 };
  const pts = sondes.flatMap((s) => s.perfil.filter((q) => q[v] != null));
  const x0 = Math.floor(Math.min(...pts.map((q) => q[v])) / 10) * 10, x1 = Math.ceil(Math.max(...pts.map((q) => q[v])) / 10) * 10;
  const y0 = 0, y1 = 3000;
  const X = (v) => m.l + ((v - x0) / (x1 - x0)) * (W - m.l - m.r);
  const Y = (v) => m.t + ((y1 - v) / (y1 - y0)) * (Hh - m.t - m.b);
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", W); svg.setAttribute("height", Hh); svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Refractividad ${v === "m" ? "modificada M" : "N"} frente a la altura en los radiosondeos de Murcia`);
  const add = (tag, attrs, text) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text != null) e.textContent = text; svg.append(e); return e; };
  const ink = cssVar("--ink-2"), grid = cssVar("--grid");
  sondes.forEach((s, i) => s.conductos.forEach((c) => add("rect", { x: m.l, width: W - m.l - m.r, y: Y(c.tope_m), height: Math.max(1, Y(c.base_m) - Y(c.tope_m)),
    fill: cssVar(cols[i % 2]), "fill-opacity": c.espesor_m >= 100 ? 0.28 : 0.12 })));
  for (let v = 0; v <= y1; v += 500) {
    add("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), stroke: grid });
    add("text", { x: m.l - 6, y: Y(v) + 4, "text-anchor": "end", fill: ink, "font-size": 12 }, v);
  }
  const xstep = (x1 - x0) > 300 ? 100 : (x1 - x0) > 120 ? 50 : 20;
  for (let v = Math.ceil(x0 / xstep) * xstep; v <= x1; v += xstep) {
    add("line", { x1: X(v), x2: X(v), y1: m.t, y2: Hh - m.b, stroke: grid });
    add("text", { x: X(v), y: Hh - m.b + 16, "text-anchor": "middle", fill: ink, "font-size": 12 }, v);
  }
  add("text", { x: W - m.r, y: Hh - 4, "text-anchor": "end", fill: ink, "font-size": 12 }, v === "m" ? "M (unidades M)" : "N (unidades N)");
  add("text", { x: 4, y: 12, fill: ink, "font-size": 12 }, "m");
  sondes.forEach((s, i) => add("polyline", { points: s.perfil.filter((q) => q[v] != null).map((q) => `${X(q[v])},${Y(q.z_m)}`).join(" "),
    fill: "none", stroke: cssVar(cols[i % 2]), "stroke-width": 2 }));
  svg.addEventListener("pointermove", (ev) => {
    const r = svg.getBoundingClientRect(), z = y1 - ((ev.clientY - r.top - m.t) / (Hh - m.t - m.b)) * (y1 - y0);
    tip(ev, sondes.map((s) => { const q = s.perfil.reduce((a, b) => (Math.abs(b.z_m - z) < Math.abs(a.z_m - z) ? b : a));
      return [`${q.z_m.toFixed(0)} m: M ${fmt1(q.m)} · N ${fmt1(q.n)}`, `T ${fmt1(q.t_c)} °C, Td ${fmt1(q.td_c)} °C (${s.nominal_utc.slice(11, 16)})`]; }));
  });
  svg.addEventListener("pointerleave", () => ($("#tip").hidden = true));
  box.append(svg);
  const head = el("tr", {}, ...["Sondeo", "Tipo", "Base–tope", "Espesor", "ΔM", "¿Atrapa 162 MHz?"].map((h, i) =>
    el("th", { textContent: h, className: i >= 3 && i < 5 ? "num" : "" })));
  const rows = sondes.flatMap((s) => s.conductos.map((c) => el("tr", {},
    el("td", { textContent: `${s.nominal_utc.slice(11, 16)} UTC` }), el("td", { textContent: c.tipo }),
    el("td", { textContent: `${c.base_m}–${c.tope_m} m` }), el("td", { className: "num", textContent: `${c.espesor_m} m` }),
    el("td", { className: "num", textContent: fmt1(c.dm) }),
    el("td", { textContent: c.espesor_m >= 100 ? "posible (≥ 100 m)" : "no (demasiado fino)" }))));
  $("#t-ducts").replaceChildren(el("thead", {}, head), el("tbody", {}, ...(rows.length ? rows
    : [el("tr", {}, el("td", { colSpan: 6, textContent: "Sin conductos en los radiosondeos de este día" }))])));
}

function renderMetar(met) {
  const head = el("tr", {}, ...["Hora (UTC)", "Estación", "T", "Td", "QNH", "Viento", "Visib."].map((h, i) =>
    el("th", { textContent: h, className: i >= 2 ? "num" : "" })));
  const rows = met.map((m) => el("tr", {}, el("td", { textContent: m.utc.slice(11, 16) }),
    el("td", { textContent: m.estacion === "LELC" ? "San Javier" : m.estacion === "LEMI" ? "Murcia" : m.estacion }),
    el("td", { className: "num", textContent: fmtN(m.t_c, 0, " °C") }), el("td", { className: "num", textContent: fmtN(m.td_c, 0, " °C") }),
    el("td", { className: "num", textContent: fmtN(m.p_hpa, 0, " hPa") }),
    el("td", { className: "num", textContent: m.viento_kn == null ? "—" : `${m.viento_kn} kn ${m.dir_deg == null ? "var." : "del " + m.dir_deg + "°"}` }),
    el("td", { className: "num", textContent: fmtN(m.vis_km, 0, " km") })));
  $("#t-metar").replaceChildren(el("thead", {}, head), el("tbody", {}, ...(rows.length ? rows
    : [el("tr", {}, el("td", { colSpan: 7, textContent: "Sin METAR" }))])));
  $("#metar-n").textContent = `(${met.length} partes)`;
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
function current() { return { "#estado": "estado", "#meteo": "meteo" }[location.hash] || "mapa"; }

function showTab(name) {
  if (location.hash !== `#${name}`) history.replaceState(null, "", `#${name}`);
  for (const t of ["mapa", "meteo", "estado"]) {
    $(`#tab-${t}`).setAttribute("aria-selected", String(t === name));
    $(`#p-${t}`).hidden = t !== name;
  }
  render();
}

function render() {
  renderStatus();
  if (current() === "mapa") {
    if (!S.map) initMap();
    S.map.invalidateSize();          // antes de encuadrar: si el mapa estaba oculto, su tamaño era 0
    renderMapTab();
  } else if (current() === "meteo") {
    renderMeteo();
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
  $("#tab-meteo").addEventListener("click", () => showTab("meteo"));
  $("#sonde-var").addEventListener("change", () => renderSonde((S.atm.get(S.day) || {}).radiosondeos || []));
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
