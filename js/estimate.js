/* ============================================================
   Rodriguez Forge: public ballpark estimator
   Reads rates + towns from Supabase, computes the range live,
   sends requests (with photos) into the private system.
   ============================================================ */
(function () {
  const { sb, log, session, SUPABASE_URL, SUPABASE_KEY } = window.RF || {};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
  const short = (n) => (n >= 1e6 ? "$" + (n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.?0+$/, "") + "M" : n >= 1e3 ? "$" + Math.round(n / 1e3) + "K" : money(n));

  const state = { towns: [], jobs: [], finishes: [], rates: [], town: null, job: null, finish: "standard", size: 1500, geo: null, photos: [] };
  const JOB_ICONS = {
    new_construction: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    remodel: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
    addition: '<rect x="3" y="9" width="10" height="12"/><path d="M13 13h8v8h-8"/><path d="M17 3v6M14 6h6"/>',
    repair: '<path d="M2 20h20"/><path d="M5 20V9l7-5 7 5v11"/><path d="M9 14h6"/>',
  };

  // ---------- Load reference data ----------
  async function load() {
    if (!sb) { showFatal(); return; }
    const t0 = performance.now();
    const [towns, jobs, fin, rates] = await Promise.all([
      sb.from("towns").select("id,slug,name,travel_adjust_pct,sort_order").order("sort_order"),
      sb.from("job_types").select("slug,name,description,default_size,max_size,size_hint").order("sort_order"),
      sb.from("finish_levels").select("slug,name,description").order("sort_order"),
      sb.from("ballpark_rates").select("job_type,finish_level,low_per_unit,high_per_unit,minimum_job,is_placeholder"),
    ]);
    const err = towns.error || jobs.error || fin.error || rates.error;
    if (err) { log("error", "estimate.load", err.message); showFatal(); return; }
    Object.assign(state, { towns: towns.data, jobs: jobs.data, finishes: fin.data, rates: rates.data });
    renderTowns(); renderJobs(); renderFinishes();
    log("ok", "page.load", "Estimator ready", { ms: Math.round(performance.now() - t0), rates: rates.data.length });
    calc();
  }

  function showFatal() {
    $("est-range").innerHTML = '<span class="est-dash">Estimator is offline. Please call us.</span>';
  }

  // ---------- Render ----------
  function renderTowns() {
    const sel = $("est-town");
    sel.innerHTML = '<option value="">Select town</option>' + state.towns.map((t) => `<option value="${t.id}">${t.name}</option>`).join("") + '<option value="other">Somewhere else</option>';
    sel.addEventListener("change", () => {
      if (sel.value === "other") { state.town = null; log("info", "town.other", "Outside listed area"); }
      else { state.town = state.towns.find((t) => String(t.id) === sel.value) || null; if (state.town) log("info", "town.select", state.town.name); }
      if (!state.geo || (state.town && state.geo.town && state.geo.town.id !== state.town.id)) state.geo = null;
      const pl = $("est-place"); if (pl && pl.classList.contains("is-warn")) pl.hidden = true;
      calc();
    });
  }

  function tile(group, slug, title, sub, icon, checked) {
    return `<label class="est-tile${checked ? " is-on" : ""}">
      <input type="radio" name="${group}" value="${slug}"${checked ? " checked" : ""} />
      ${icon ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>` : ""}
      <strong>${title}</strong><span>${sub || ""}</span></label>`;
  }

  function bindTiles(container, group, onPick) {
    container.addEventListener("change", (e) => {
      if (e.target.name !== group) return;
      container.querySelectorAll(".est-tile").forEach((l) => l.classList.toggle("is-on", l.contains(e.target)));
      onPick(e.target.value);
    });
  }

  function renderJobs() {
    const c = $("est-jobs");
    c.innerHTML = state.jobs.map((j) => tile("job", j.slug, j.name, j.description, JOB_ICONS[j.slug])).join("");
    bindTiles(c, "job", (v) => { state.job = v; applyJobSize(); log("info", "job.select", v); calc(); });
  }

  function renderFinishes() {
    const c = $("est-finishes");
    c.innerHTML = state.finishes.map((f) => tile("finish", f.slug, f.name, f.description, null, f.slug === state.finish)).join("");
    bindTiles(c, "finish", (v) => { state.finish = v; log("info", "finish.select", v); calc(); });
  }

  // ---------- Size ----------
  const size = $("est-size"), slider = $("est-slider");
  let sizeTouched = false, sliderMax = 5000;
  function setSize(v, from) {
    v = Math.max(50, Math.min(10000, Number(v) || 0));
    state.size = v;
    if (from !== "num") size.value = v;
    if (from !== "slider") slider.value = Math.min(v, sliderMax);
    slider.style.setProperty("--p", ((Math.min(v, sliderMax) - 50) / (sliderMax - 50)) * 100 + "%");
    calc();
  }
  function applyJobSize() {
    const j = state.jobs.find((x) => x.slug === state.job);
    if (!j) return;
    sliderMax = j.max_size || 5000;
    slider.max = sliderMax;
    const steps = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round((50 + f * (sliderMax - 50)) / 50) * 50 || 50);
    document.querySelector(".est-ticks").innerHTML = steps.map((n, i) => `<span>${n.toLocaleString()}${i === 4 ? "+" : ""}</span>`).join("");
    if (j.size_hint) document.querySelector(".est-hint").textContent = j.size_hint;
    setSize(sizeTouched ? state.size : (j.default_size || 1500));
  }
  slider.addEventListener("input", () => { sizeTouched = true; setSize(slider.value, "slider"); });
  size.addEventListener("input", () => { if (size.value) { sizeTouched = true; setSize(size.value, "num"); } });
  size.addEventListener("blur", () => setSize(size.value));
  slider.addEventListener("change", () => log("info", "size.set", String(state.size)));
  setSize(1500);

  // ---------- Address: suggestions as you type, then lookup ----------
  const addr = $("est-address"), place = $("est-place"), list = $("est-suggest");
  let sugTimer = null, sugSeq = 0, sugItems = [], sugIndex = -1;

  async function geo(body) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/geocode`, {
      method: "POST", headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
      body: JSON.stringify({ ...body, session }),
    });
    return res.json();
  }

  function showPlace(g) {
    if (!g.found) {
      state.geo = null;
      place.hidden = false; place.className = "est-place is-warn";
      place.textContent = g.message || "We couldn't find that address. Pick your town below and keep going.";
      log("warn", "address.lookup.miss", "No match");
      return;
    }
    state.geo = g;
    const where = g.place ? `${g.place}${g.in_city_limits ? "" : " area"}` : `${g.county || "Unknown"} County`;
    place.hidden = false;
    if (g.town) {
      state.town = state.towns.find((t) => t.id === g.town.id) || null;
      $("est-town").value = state.town ? String(state.town.id) : "";
      place.className = "est-place is-ok";
      place.innerHTML = `<b>${esc(where)}</b><span>${esc(g.county)} County · ${g.in_city_limits ? "inside city limits" : "outside city limits"} · about ${g.distance_miles} mi from Eloy</span>`;
    } else {
      state.town = null; $("est-town").value = "other";
      place.className = "est-place is-warn";
      place.innerHTML = `<b>${esc(where)}${g.state ? ", " + esc(g.state) : ""}</b><span>That's outside our usual area, about ${g.distance_miles} mi out. Send a request anyway and we'll let you know.</span>`;
    }
    log("ok", "address.lookup.done", where, { town: g.town ? g.town.slug : null, miles: g.distance_miles, source: g.source });
  }

  function busy(on, text) {
    const btn = $("est-lookup");
    btn.disabled = on; btn.textContent = on ? "Finding…" : "Find";
    if (on) { place.hidden = false; place.className = "est-place is-loading"; place.textContent = text; }
  }

  // Typed address (Find button, or Enter with nothing highlighted)
  async function lookup() {
    const a = addr.value.trim();
    closeList();
    if (a.length < 6) { addr.focus(); return; }
    busy(true, "Looking up your address…");
    log("info", "address.lookup.start", "Typed lookup");
    try { showPlace(await geo({ address: a })); }
    catch (e) { showPlace({ found: false, message: "Lookup is having trouble. Pick your town below." }); log("error", "address.lookup.fail", String(e)); }
    finally { busy(false); calc(); }
  }

  // Picked from the list
  async function pick(i) {
    const s = sugItems[i];
    if (!s) return;
    addr.value = s.label;
    closeList();
    busy(true, "Finding your area…");
    log("info", "address.suggest.pick", "Suggestion picked", { position: i + 1 });
    try { showPlace(await geo({ action: "resolve", key: s.key, label: s.label })); }
    catch (e) { showPlace({ found: false, message: "Lookup is having trouble. Pick your town below." }); log("error", "address.lookup.fail", String(e)); }
    finally { busy(false); calc(); }
  }

  function renderList() {
    if (!sugItems.length) { closeList(); return; }
    list.innerHTML = sugItems.map((s, i) => {
      const [first, ...rest] = s.label.split(", ");
      return `<li role="option" id="sug-${i}" class="${i === sugIndex ? "is-active" : ""}" data-i="${i}" aria-selected="${i === sugIndex}"><b>${esc(first)}</b><span>${esc(rest.join(", "))}</span></li>`;
    }).join("");
    list.hidden = false;
    addr.setAttribute("aria-expanded", "true");
    if (sugIndex >= 0) addr.setAttribute("aria-activedescendant", `sug-${sugIndex}`); else addr.removeAttribute("aria-activedescendant");
  }
  function closeList() { list.hidden = true; sugIndex = -1; addr.setAttribute("aria-expanded", "false"); addr.removeAttribute("aria-activedescendant"); }

  addr.addEventListener("input", () => {
    clearTimeout(sugTimer);
    if (state.geo) { state.geo = null; place.hidden = true; }
    const q = addr.value.trim();
    if (q.length < 4) { sugItems = []; closeList(); return; }
    sugTimer = setTimeout(async () => {
      const seq = ++sugSeq;
      try {
        const r = await geo({ action: "suggest", q });
        if (seq !== sugSeq) return; // a newer keystroke won
        sugItems = r.suggestions || []; sugIndex = -1; renderList();
      } catch (e) { log("warn", "address.suggest.fail", String(e)); }
    }, 280);
  });

  addr.addEventListener("keydown", (e) => {
    const open = !list.hidden && sugItems.length;
    if (e.key === "ArrowDown" && open) { e.preventDefault(); sugIndex = (sugIndex + 1) % sugItems.length; renderList(); }
    else if (e.key === "ArrowUp" && open) { e.preventDefault(); sugIndex = (sugIndex - 1 + sugItems.length) % sugItems.length; renderList(); }
    else if (e.key === "Escape") { closeList(); }
    else if (e.key === "Enter") { e.preventDefault(); if (open && sugIndex >= 0) pick(sugIndex); else lookup(); }
  });
  list.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus so the tap registers
  list.addEventListener("click", (e) => { const li = e.target.closest("li[data-i]"); if (li) pick(Number(li.dataset.i)); });
  addr.addEventListener("blur", () => setTimeout(closeList, 150));
  addr.addEventListener("focus", () => { if (window.innerWidth < 960) setTimeout(() => addr.scrollIntoView({ block: "start", behavior: "smooth" }), 250); });
  $("est-lookup").addEventListener("click", lookup);

  // ---------- Math (mirrors calc_ballpark in the database) ----------
  let calcTimer;
  function compute() {
    const r = state.rates.find((x) => x.job_type === state.job && x.finish_level === state.finish);
    if (!r || !state.size) return null;
    const adj = 1 + (state.town ? Number(state.town.travel_adjust_pct) : 3) / 100;
    const round = (n) => Math.round(n / 100) * 100;
    return {
      low: round(Math.max(Number(r.minimum_job), r.low_per_unit * state.size) * adj),
      high: round(Math.max(Number(r.minimum_job), r.high_per_unit * state.size) * adj),
      placeholder: r.is_placeholder,
    };
  }

  function calc() {
    const out = compute();
    const ready = Boolean(out);
    $("est-request-open").disabled = !ready;
    $("est-sample").hidden = !(out && out.placeholder);
    const job = state.jobs.find((j) => j.slug === state.job);
    const fin = state.finishes.find((f) => f.slug === state.finish);
    $("est-summary").innerHTML = [
      ["Where", state.town ? state.town.name : state.geo ? state.geo.place || "Outside area" : "Not set"],
      ["Project", job ? job.name : "Not set"],
      ["Size", state.size.toLocaleString() + " sq ft"],
      ["Finish", fin ? fin.name : "Not set"],
    ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");

    if (!ready) {
      $("est-range").innerHTML = `<span class="est-dash">${state.job ? "Answer the questions" : "Pick a project type"}</span>`;
      $("est-bar-fill").style.width = "0%";
      $("est-dock").hidden = true;
      return;
    }
    $("est-range").innerHTML = `<span>${money(out.low)}</span><i>to</i><span>${money(out.high)}</span>`;
    $("est-bar-fill").style.width = Math.min(100, 12 + (Math.log10(out.high) - 3) * 22) + "%";
    $("est-dock-range").textContent = `${short(out.low)} to ${short(out.high)}`;
    $("est-dock").hidden = false;
    clearTimeout(calcTimer);
    calcTimer = setTimeout(() => log("info", "estimate.calculate", `${short(out.low)}-${short(out.high)}`, { job: state.job, finish: state.finish, size: state.size, town: state.town && state.town.slug }), 1200);
  }

  // ---------- Request form ----------
  const reqSec = $("est-request");
  function openRequest() {
    reqSec.hidden = false;
    reqSec.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => $("req-name").focus({ preventScroll: true }), 500);
    log("info", "request.open", "Request form opened");
  }
  $("est-request-open").addEventListener("click", openRequest);
  $("est-dock").addEventListener("click", openRequest);

  // Hide the dock while the result card or request form is on screen
  if ("IntersectionObserver" in window) {
    const seen = new Set();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => (e.isIntersecting ? seen.add(e.target) : seen.delete(e.target)));
      document.body.classList.toggle("est-dock-hide", seen.size > 0);
    }, { threshold: 0.15 });
    io.observe($("est-result")); io.observe(reqSec);
  }

  // Photos: shrink on the phone before upload
  const thumbs = $("req-thumbs");
  $("req-photos").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    for (const f of files) {
      if (state.photos.length >= 8) { log("warn", "photo.limit", "Max 8 photos"); break; }
      const blob = await shrink(f);
      state.photos.push(blob);
      const url = URL.createObjectURL(blob);
      const d = document.createElement("div");
      d.className = "est-thumb";
      d.innerHTML = `<img src="${url}" alt="" /><button type="button" aria-label="Remove photo">×</button>`;
      d.querySelector("button").onclick = () => { state.photos.splice(state.photos.indexOf(blob), 1); d.remove(); };
      thumbs.appendChild(d);
    }
    log("info", "photo.add", `${state.photos.length} photo(s) attached`);
    e.target.value = "";
  });

  function shrink(file) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const max = 2000, s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        c.toBlob((b) => { URL.revokeObjectURL(url); resolve(b || file); }, "image/jpeg", 0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  $("req-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("req-error"), btn = $("req-submit");
    const name = $("req-name").value.trim(), phone = $("req-phone").value.trim(), email = $("req-email").value.trim();
    err.hidden = true;
    if (!name) return fail("Please add your name.");
    if (!phone && !email) return fail("Add a phone number or email so we can reach you.");
    if (email && !/^\S+@\S+\.\S+$/.test(email)) return fail("That email doesn't look right.");

    btn.disabled = true; btn.textContent = "Sending…";
    const out = compute();
    const payload = {
      full_name: name, phone, email, preferred_contact: $("req-contact").value,
      timeline: $("req-timeline").value, payment_plan: $("req-pay").value, message: $("req-message").value.trim(),
      address: addr.value.trim(), job_type: state.job, finish_level: state.finish, size_value: state.size,
      town_id: state.town ? state.town.id : "",
      county: state.geo ? state.geo.county : "", in_city_limits: state.geo ? state.geo.in_city_limits : "",
      latitude: state.geo ? state.geo.latitude : "", longitude: state.geo ? state.geo.longitude : "",
      distance_miles: state.geo ? state.geo.distance_miles : "",
    };
    log("info", "request.submit.start", "Submitting", { job: state.job, photos: state.photos.length, payment: $("req-pay").value });

    const { data: reqId, error } = await sb.rpc("submit_request", { p: payload });
    if (error) {
      log("error", "request.submit.fail", error.message);
      btn.disabled = false; btn.textContent = "Send my request";
      return fail(error.message.includes("Too many") ? error.message : "Something went wrong sending that. Please try again or call us.");
    }
    log("ok", "request.submit.done", "Request saved", { low: out && out.low, high: out && out.high }, reqId);

    let ok = 0;
    for (let i = 0; i < state.photos.length; i++) {
      btn.textContent = `Uploading photo ${i + 1} of ${state.photos.length}…`;
      const path = `${reqId}/${Date.now()}-${i}.jpg`;
      const up = await sb.storage.from("request-photos").upload(path, state.photos[i], { contentType: state.photos[i].type || "image/jpeg" });
      if (up.error) { log("error", "photo.upload.fail", up.error.message, { i }, reqId); continue; }
      const at = await sb.rpc("attach_photo", { p_request: reqId, p_path: path });
      if (at.error) { log("error", "photo.attach.fail", at.error.message, { i }, reqId); continue; }
      ok++;
    }
    if (state.photos.length) log(ok === state.photos.length ? "ok" : "warn", "photo.upload.done", `${ok}/${state.photos.length} uploaded`, null, reqId);

    $("req-form").hidden = true;
    const done = $("req-done");
    $("req-done-text").textContent = `Thanks, ${name.split(" ")[0]}. We'll reach out by ${$("req-contact").value} soon to set up a time to see the property.`;
    done.hidden = false; done.focus();
    $("est-dock").hidden = true;

    function fail(msg) { err.textContent = msg; err.hidden = false; err.scrollIntoView({ block: "center", behavior: "smooth" }); }
  });

  load();
})();
