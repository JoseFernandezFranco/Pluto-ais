// Capa «Malla del entorno» para el mapa de trayectos: celdas de mar (acimut × distancia al receptor), cada hora, del día elegido.
// Datos: data/<campaña>/entorno_malla/index.json + <día>.csv.gz (plutoais.entorno). Se activa en el control de capas del mapa.
const MallaCapa = (() => {
  const VARS = {
    hm0_m: ["Altura significante del oleaje", "m", 2], costa_tp_s: ["Periodo pico del oleaje", "s", 1],
    costa_dir_media_deg: ["Dirección del oleaje", "°", 0], corr_vel_ms: ["Velocidad de la corriente", "m/s", 3],
    corr_dir_deg: ["Dirección de la corriente (hacia)", "°", 0], temp_agua_c: ["Temperatura del agua", "°C", 2],
    salinidad_psu: ["Salinidad", "PSU", 2], viento_ms: ["Viento a 10 m", "m/s", 1], viento_dir_deg: ["Dirección del viento (de)", "°", 0],
    rafaga_ms: ["Racha", "m/s", 1], presion_hpa: ["Presión", "hPa", 1], temp_aire_c: ["Temperatura del aire", "°C", 1],
    humedad_pct: ["Humedad relativa", "%", 0], nubosidad_pct: ["Nubosidad", "%", 0], n_sup: ["Refractividad en superficie N", "N", 1],
    dndh_1km: ["Gradiente dN/dh 0–1 km", "N/km", 1], k: ["Factor k efectivo", "", 3], dt_mar_aire_c: ["T agua − T aire", "°C", 2],
  };
  const MAPV = ["hm0_m", "corr_vel_ms", "temp_agua_c", "salinidad_psu", "viento_ms", "temp_aire_c", "n_sup", "dndh_1km", "k",
    "dt_mar_aire_c", "presion_hpa", "humedad_pct", "nubosidad_pct", "costa_tp_s", "rafaga_ms"];
  const STOPS = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];
  const R = 111.19, rad = Math.PI / 180;
  let map, group, getState, panel, G = { az: 10, rs: 20, rmax: 320, rx: [37.6, -0.98] }, D = null, polys = [], loaded = null, token = 0;
  const $ = (s) => panel.querySelector(s);

  const col = (t) => {
    t = Math.max(0, Math.min(1, t));
    const x = t * (STOPS.length - 1), i = Math.min(STOPS.length - 2, Math.floor(x)), f = x - i, a = STOPS[i], b = STOPS[i + 1];
    return "rgb(" + a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(",") + ")";
  };
  const pt = (az, r) => [G.rx[0] + r * Math.cos(az * rad) / R, G.rx[1] + r * Math.sin(az * rad) / (R * Math.cos(G.rx[0] * rad))];
  function poly(az, r) {
    const a0 = az - G.az / 2, a1 = az + G.az / 2, r0 = r - G.rs / 2, r1 = r + G.rs / 2, n = 4, p = [];
    for (let k = 0; k <= n; k++) p.push(pt(a0 + (a1 - a0) * k / n, r1));
    for (let k = n; k >= 0; k--) p.push(pt(a0 + (a1 - a0) * k / n, r0));
    return p;
  }
  const msg = (t) => { $(".mc-msg").textContent = t || ""; };

  function build() {
    group.clearLayers();
    polys = D.cells.map(([az, r], i) => L.polygon(poly(az, r), { pane: "malla", weight: 0.5, color: "#222", fillOpacity: 0.7 })
      .addTo(group).on("click", () => popup(i)));
    const sel = $(".mc-var"), prev = sel.value;
    sel.replaceChildren();
    MAPV.filter((v) => v in D.data).forEach((v) => {
      const m = VARS[v], o = document.createElement("option");
      o.value = v; o.textContent = m[0] + (m[1] ? " (" + m[1] + ")" : "") + (D.ok[v] ? "" : " — sin datos");
      if (!D.ok[v]) o.disabled = true;
      sel.appendChild(o);
    });
    sel.value = D.ok[prev] ? prev : (MAPV.find((v) => D.ok[v]) || "");
    draw();
  }
  function range(v) {
    let lo = 1e99, hi = -1e99;
    D.data[v].forEach((h) => h.forEach((x) => { if (x !== null) { lo = Math.min(lo, x); hi = Math.max(hi, x); } }));
    if (lo === hi) { lo -= 0.5; hi += 0.5; }
    return [lo, hi];
  }
  function draw() {
    if (!D) return;
    const v = $(".mc-var").value, h = +$(".mc-hr").value, op = +$(".mc-op").value / 100;
    $(".mc-hl").textContent = String(h).padStart(2, "0") + ":00";
    if (!v) { polys.forEach((p) => p.setStyle({ fillOpacity: 0.08, fillColor: "#999" })); return; }
    const m = VARS[v], [lo, hi] = range(v);
    $(".mc-lt").textContent = m[0] + (m[1] ? " (" + m[1] + ")" : "");
    $(".mc-l0").textContent = lo.toFixed(m[2]); $(".mc-l1").textContent = hi.toFixed(m[2]);
    let n = 0;
    polys.forEach((p, i) => {
      const x = D.data[v][h][i];
      if (x === null) p.setStyle({ fillOpacity: 0.08, fillColor: "#999" });
      else { n++; p.setStyle({ fillColor: col((x - lo) / (hi - lo)), fillOpacity: op }); }
    });
    $(".mc-info").textContent = D.day + " · " + n + "/" + D.cells.length + " celdas con dato";
  }
  function popup(i) {
    const h = +$(".mc-hr").value, [az, r] = D.cells[i];
    let s = "<b>Acimut " + az + "° · " + (r - G.rs / 2) + "–" + (r + G.rs / 2) + " km</b><br>" + String(h).padStart(2, "0") + ":00 UTC<table>";
    Object.keys(D.data).forEach((v) => {
      const x = D.data[v][h][i], m = VARS[v];
      s += "<tr><td style='padding-right:8px'>" + m[0] + "</td><td><b>" + (x === null ? "—" : x + " " + m[1]) + "</b></td></tr>";
    });
    L.popup().setLatLng(pt(az, r)).setContent(s + "</table>").openOn(map);
  }

  async function load(camp, day) {
    const my = ++token;
    if (!camp || !day) { msg("Elige un día."); return; }
    msg("Cargando malla de " + day + "…");
    try {
      const b = `data/${camp}/entorno_malla/`;
      try {
        const ix = await (await fetch(b + "index.json?v=" + Date.now())).json();
        G = { az: ix.az_step_deg || G.az, rs: ix.r_step_km || G.rs, rmax: ix.r_max_km || G.rmax, rx: ix.receptor || G.rx };
        if (!(ix.dias || []).includes(day)) { if (my === token) { group.clearLayers(); D = null; msg("Sin malla publicada para " + day + "."); } return; }
      } catch { if (my === token) { group.clearLayers(); D = null; msg("Aún no hay malla publicada para esta campaña."); } return; }
      const r = await fetch(`${b}${day}.csv.gz?v=${Math.floor(Date.now() / 600000)}`);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const txt = await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text();
      if (my !== token) return;                                     // el usuario ya cambió de día
      const ln = txt.split("\n"), head = ln[0].split(","), cells = new Map(), rows = [];
      let t0 = 1e99;
      for (let i = 1; i < ln.length; i++) { if (!ln[i]) continue; const v = ln[i].split(","); rows.push(v); t0 = Math.min(t0, +v[0]); }
      rows.forEach((v) => { const k = v[1] + "|" + v[2]; if (!cells.has(k)) cells.set(k, [+v[1], +v[2]]); });
      const list = [...cells.values()].sort((a, b2) => a[0] - b2[0] || a[1] - b2[1]), idx = new Map(list.map((c, i) => [c[0] + "|" + c[1], i]));
      const present = head.slice(5).filter((h) => VARS[h]), data = {};
      present.forEach((h) => { data[h] = Array.from({ length: 24 }, () => new Array(list.length).fill(null)); });
      rows.forEach((v) => {
        const hh = Math.round((+v[0] - t0) / 3600), i = idx.get(v[1] + "|" + v[2]);
        if (hh < 0 || hh > 23) return;
        head.forEach((h, k) => { if (k >= 5 && data[h] && v[k] !== "") data[h][hh][i] = +v[k]; });
      });
      const ok = {}; present.forEach((h) => { ok[h] = data[h].some((a) => a.some((x) => x !== null)); });
      D = { day, cells: list, data, ok }; loaded = camp + "|" + day;
      const today = new Date().toISOString().slice(0, 10);
      $(".mc-hr").value = day === today ? new Date().getUTCHours() : 12;
      msg(""); build();
    } catch (e) { if (my === token) msg("No se pudo cargar la malla: " + e.message); }
  }

  function show() { const s = getState(); if (loaded !== s.camp + "|" + s.day) load(s.camp, s.day); }
  function init(m, layer, state) {
    map = m; group = layer; getState = state;
    map.createPane("malla").style.zIndex = 350;                      // debajo de trayectos y barcos
    const Ctl = L.Control.extend({
      onAdd() {
        panel = L.DomUtil.create("div", "leaflet-control malla-panel");
        panel.style.cssText = "background:#fffffff0;padding:8px 10px;width:230px;font-size:12px;line-height:1.3;border-radius:6px;box-shadow:0 1px 5px rgba(0,0,0,.45)";
        panel.innerHTML = "<b>Malla del entorno</b> <span class='mc-info' style='color:#555'></span>"
          + "<select class='mc-var' style='width:100%;margin:4px 0'></select>"
          + "<div>Hora UTC <b class='mc-hl'></b> <button class='mc-play' style='padding:0 6px'>▶</button></div>"
          + "<input class='mc-hr' type='range' min='0' max='23' value='12' style='width:100%'>"
          + "<div>Opacidad</div><input class='mc-op' type='range' min='10' max='100' value='70' style='width:100%'>"
          + "<div class='mc-lt' style='font-weight:600;margin-top:4px'></div>"
          + "<div style='height:10px;border-radius:3px;background:linear-gradient(90deg," + [0, .25, .5, .75, 1].map(col).join(",") + ")'></div>"
          + "<div style='display:flex;justify-content:space-between'><span class='mc-l0'></span><span class='mc-l1'></span></div>"
          + "<div class='mc-msg' style='color:#b00'></div>"
          + "<a href='malla.html' style='font-size:11px'>página completa ↗</a>";
        L.DomEvent.disableClickPropagation(panel); L.DomEvent.disableScrollPropagation(panel);
        return panel;
      },
    });
    new Ctl({ position: "bottomleft" }).addTo(map);
    panel.style.display = "none";
    ["var", "hr", "op"].forEach((c) => $(".mc-" + c).addEventListener("input", draw));
    let timer = null;
    $(".mc-play").onclick = () => {
      if (timer) { clearInterval(timer); timer = null; $(".mc-play").textContent = "▶"; }
      else { $(".mc-play").textContent = "⏸"; timer = setInterval(() => { $(".mc-hr").value = (+$(".mc-hr").value + 1) % 24; draw(); }, 600); }
    };
    map.on("overlayadd", (e) => { if (e.layer === group) { panel.style.display = ""; show(); } });
    map.on("overlayremove", (e) => { if (e.layer === group) { panel.style.display = "none"; map.closePopup(); } });
  }
  // el panel llama aquí al cambiar de campaña o de día: si la capa está activa, recarga
  const refresh = () => { if (panel && map.hasLayer(group)) show(); };
  return { init, refresh };
})();
