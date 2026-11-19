/* ============================================================
   Rodriguez Forge: public ballpark estimator
   Reads rates + towns from Supabase, computes the range live,
   remembers answers on this device, sends requests (with photos)
   into the private system.
   ============================================================ */
(function () {
  const { sb, log, session, SUPABASE_URL, SUPABASE_KEY } = window.RF || {};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
  const short = (n) => (n >= 1e6 ? "$" + (n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.?0+$/, "") + "M" : n >= 1e4 ? "$" + Math.round(n / 1e3) + "K" : n >= 1e3 ? "$" + (Math.round(n / 100) / 10).toString().replace(/\.0$/, "") + "K" : money(n));
  const PAGE_LOADED = Date.now();
  const DRAFT_KEY = "rf-estimate-draft-v1";

  const state = {
    towns: [], jobs: [], finishes: [], rates: [], tiers: [],
    town: null, job: null, finish: "standard", size: 1500, tier: null, geo: null, photos: [],
  };
  const JOB_ICONS = {
    new_construction: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    remodel: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
    addition: '<rect x="3" y="9" width="10" height="12"/><path d="M13 13h8v8h-8"/><path d="M17 3v6M14 6h6"/>',
    repair: '<path d="M2 20h20"/><path d="M5 20V9l7-5 7 5v11"/><path d="M9 14h6"/>',
  };
  const jobOf = () => state.jobs.find((j) => j.slug === state.job);
  const isTierJob = () => (jobOf() || {}).pricing_mode === "tier";

  // ---------- Load reference data ----------
  async function load() {
    if (!sb) { showFatal(); return; }
    const t0 = performance.now();
    const [towns, jobs, fin, rates, tiers] = await Promise.all([
      sb.from("towns").select("id,slug,name,travel_adjust_pct,sort_order").order("sort_order"),
      sb.from("job_types").select("slug,name,description,default_size,max_size,size_hint,pricing_mode").order("sort_order"),
      sb.from("finish_levels").select("slug,name,description,tier_multiplier").order("sort_order"),
      sb.from("ballpark_rates").select("job_type,finish_level,low_per_unit,high_per_unit,minimum_job,is_placeholder"),
      sb.from("job_tiers").select("job_type,slug,name,description,low,high,is_placeholder").order("sort_order"),
    ]);
    const err = towns.error || jobs.error || fin.error || rates.error || tiers.error;
    if (err) { log("error", "estimate.load", err.message); showFatal(); return; }
    Object.assign(state, { towns: towns.data, jobs: jobs.data, finishes: fin.data, rates: rates.data, tiers: tiers.data });
    renderTowns(); renderJobs(); renderFinishes();
    const restored = restoreDraft();
    log("ok", "page.load", "Estimator ready", { ms: Math.round(performance.now() - t0), restored });
    calc();
  }

  function showFatal() {
    $("est-range").innerHTML = '<span class="est-dash">Estimator is offline. Please call us.</span>';
  }

  // ---------- Render ----------
  function renderTowns() {
    const sel = $("est-town");
    sel.innerHTML = '<option value="">Select town</option>' + state.towns.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("") + '<option value="other">Somewhere else</option>';
    sel.addEventListener("change", () => {
      setTown(sel.value);
      if (state.town) log("info", "town.select", state.town.name); else if (sel.value === "other") log("info", "town.other", "Outside listed area");
      if (!state.geo || (state.town && state.geo.town && state.geo.town.id !== state.town.id)) state.geo = null;
      if (place.classList.contains("is-warn")) place.hidden = true;
      calc(); saveDraft();
    });
  }
  function setTown(v) {
    $("est-town").value = v || "";
    state.town = v && v !== "other" ? state.towns.find((t) => String(t.id) === String(v)) || null : null;
  }

  function tile(group, slug, title, sub, icon, checked) {
    return `<label class="est-tile${checked ? " is-on" : ""}">
      <input type="radio" name="${group}" value="${esc(slug)}"${checked ? " checked" : ""} />
      ${icon ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>` : ""}
      <strong>${esc(title)}</strong><span>${esc(sub || "")}</span></label>`;
  }
  function bindTiles(container, group, onPick) {
    container.addEventListener("change", (e) => {
      if (e.target.name !== group) return;
      markTiles(container, e.target.value);
      onPick(e.target.value);
    });
  }
  function markTiles(container, value) {
    container.querySelectorAll(".est-tile").forEach((l) => {
      const inp = l.querySelector("input");
      inp.checked = inp.value === value;
      l.classList.toggle("is-on", inp.checked);
    });
  }

  function renderJobs() {
    const c = $("est-jobs");
    c.innerHTML = state.jobs.map((j) => tile("job", j.slug, j.name, j.description, JOB_ICONS[j.slug])).join("");
    bindTiles(c, "job", (v) => { selectJob(v); log("info", "job.select", v); saveDraft(); });
  }
  function renderFinishes() {
    const c = $("est-finishes");
    c.innerHTML = state.finishes.map((f) => tile("finish", f.slug, f.name, f.description, null, f.slug === state.finish)).join("");
    bindTiles(c, "finish", (v) => { state.finish = v; log("info", "finish.select", v); calc(); saveDraft(); });
  }

  function selectJob(v) {
    state.job = v;
    markTiles($("est-jobs"), v);
    const tierMode = isTierJob();
    $("est-size-block").hidden = tierMode;
    $("est-tiers").hidden = !tierMode;
    if (tierMode) renderTiers(); else applyJobSize();
    calc();
  }

  // ---------- Job size tiers (repairs) ----------
  function renderTiers() {
    const c = $("est-tiers");
    const list = state.tiers.filter((t) => t.job_type === state.job);
    if (!list.some((t) => t.slug === state.tier)) state.tier = null;
    c.innerHTML = list.map((t) => tile("tier", t.slug, t.name, t.description, null, t.slug === state.tier)).join("");
  }
  bindTiles($("est-tiers"), "tier", (v) => { state.tier = v; log("info", "tier.select", v); calc(); saveDraft(); });

  // ---------- Size (square feet) ----------
  const size = $("est-size"), slider = $("est-slider");
  let sizeTouched = false, sliderMax = 5000;
  function fitSize() { size.style.width = (Math.max(2, String(size.value || "").length) + 0.7) + "ch"; }
  function setSize(v, from) {
    v = Math.max(50, Math.min(10000, Number(v) || 0));
    state.size = v;
    if (from !== "num") size.value = v;
    if (from !== "slider") slider.value = Math.min(v, sliderMax);
    slider.style.setProperty("--p", ((Math.min(v, sliderMax) - 50) / (sliderMax - 50)) * 100 + "%");
    fitSize(); calc();
  }
  function applyJobSize() {
    const j = jobOf();
    if (!j) return;
    sliderMax = j.max_size || 5000;
    slider.max = sliderMax;
    const steps = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round((50 + f * (sliderMax - 50)) / 50) * 50 || 50);
    document.querySelector(".est-ticks").innerHTML = steps.map((n, i) => `<span>${n.toLocaleString()}${i === 4 ? "+" : ""}</span>`).join("");
    if (j.size_hint) document.querySelector(".est-hint").textContent = j.size_hint;
    setSize(sizeTouched ? state.size : (j.default_size || 1500));
  }
  slider.addEventListener("input", () => { sizeTouched = true; setSize(slider.value, "slider"); });
  size.addEventListener("input", () => { fitSize(); if (size.value) { sizeTouched = true; setSize(size.value, "num"); } });
  size.addEventListener("blur", () => { setSize(size.value); saveDraft(); });
  slider.addEventListener("change", () => { log("info", "size.set", String(state.size)); saveDraft(); });
  setSize(1500);

  // ---------- Address: suggestions as you type, then lookup ----------
  const addr = $("est-address"), place = $("est-place"), sugList = $("est-suggest");
  let sugTimer = null, sugSeq = 0, sugItems = [], sugIndex = -1;

  async function geo(body) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/geocode`, {
      method: "POST", headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
      body: JSON.stringify({ ...body, session }),
    });
    return res.json();
  }

  function showPlace(g, quiet) {
    if (!g || !g.found) {
      state.geo = null;
      place.hidden = false; place.className = "est-place is-warn";
      place.textContent = (g && g.message) || "We couldn't find that address. Pick your town below and keep going.";
      if (!quiet) log("warn", "address.lookup.miss", "No match");
      return;
    }
    state.geo = g;
    const where = g.place ? `${g.place}${g.in_city_limits ? "" : " area"}` : `${g.county || "Unknown"} County`;
    place.hidden = false;
    if (g.town) {
      setTown(g.town.id);
      place.className = "est-place is-ok";
      place.innerHTML = `<b>${esc(where)}</b><span>${esc(g.county)} County · ${g.in_city_limits ? "inside city limits" : "outside city limits"} · about ${g.distance_miles} mi from Eloy</span>`;
    } else {
      setTown("other");
      place.className = "est-place is-warn";
      place.innerHTML = `<b>${esc(where)}${g.state ? ", " + esc(g.state) : ""}</b><span>That's outside our usual area, about ${g.distance_miles} mi out. Send a request anyway and we'll let you know.</span>`;
    }
    if (!quiet) log("ok", "address.lookup.done", where, { town: g.town ? g.town.slug : null, miles: g.distance_miles, source: g.source });
  }

  function busy(on, text) {
    const btn = $("est-lookup");
    btn.disabled = on; btn.textContent = on ? "Finding…" : "Find";
    if (on) { place.hidden = false; place.className = "est-place is-loading"; place.textContent = text; }
  }

  async function lookup() {
    const a = addr.value.trim();
    closeList();
    if (a.length < 6) { addr.focus(); return; }
    busy(true, "Looking up your address…");
    log("info", "address.lookup.start", "Typed lookup");
    try { showPlace(await geo({ address: a })); }
    catch (e) { showPlace({ found: false, message: "Lookup is having trouble. Pick your town below." }); log("error", "address.lookup.fail", String(e)); }
    finally { busy(false); calc(); saveDraft(); }
  }

  async function pick(i) {
    const s = sugItems[i];
    if (!s) return;
    addr.value = s.label;
    closeList();
    busy(true, "Finding your area…");
    log("info", "address.suggest.pick", "Suggestion picked", { position: i + 1 });
    try { showPlace(await geo({ action: "resolve", key: s.key, label: s.label })); }
    catch (e) { showPlace({ found: false, message: "Lookup is having trouble. Pick your town below." }); log("error", "address.lookup.fail", String(e)); }
    finally { busy(false); calc(); saveDraft(); }
  }

  function renderList() {
    if (!sugItems.length) { closeList(); return; }
    sugList.innerHTML = sugItems.map((s, i) => {
      const [first, ...rest] = s.label.split(", ");
      return `<li role="option" id="sug-${i}" class="${i === sugIndex ? "is-active" : ""}" data-i="${i}" aria-selected="${i === sugIndex}"><b>${esc(first)}</b><span>${esc(rest.join(", "))}</span></li>`;
    }).join("");
    sugList.hidden = false;
    addr.setAttribute("aria-expanded", "true");
    if (sugIndex >= 0) addr.setAttribute("aria-activedescendant", `sug-${sugIndex}`); else addr.removeAttribute("aria-activedescendant");
  }
  function closeList() { sugList.hidden = true; sugIndex = -1; addr.setAttribute("aria-expanded", "false"); addr.removeAttribute("aria-activedescendant"); }

  addr.addEventListener("input", () => {
    clearTimeout(sugTimer);
    if (state.geo) { state.geo = null; place.hidden = true; }
    const q = addr.value.trim();
    if (q.length < 4) { sugItems = []; closeList(); return; }
    sugTimer = setTimeout(async () => {
      const seq = ++sugSeq;
      try {
        const r = await geo({ action: "suggest", q });
        if (seq !== sugSeq) return;
        sugItems = r.suggestions || []; sugIndex = -1; renderList();
      } catch (e) { log("warn", "address.suggest.fail", String(e)); }
    }, 280);
  });
  addr.addEventListener("keydown", (e) => {
    const open = !sugList.hidden && sugItems.length;
    if (e.key === "ArrowDown" && open) { e.preventDefault(); sugIndex = (sugIndex + 1) % sugItems.length; renderList(); }
    else if (e.key === "ArrowUp" && open) { e.preventDefault(); sugIndex = (sugIndex - 1 + sugItems.length) % sugItems.length; renderList(); }
    else if (e.key === "Escape") { closeList(); }
    else if (e.key === "Enter") { e.preventDefault(); if (open && sugIndex >= 0) pick(sugIndex); else lookup(); }
  });
  sugList.addEventListener("mousedown", (e) => e.preventDefault());
  sugList.addEventListener("click", (e) => { const li = e.target.closest("li[data-i]"); if (li) pick(Number(li.dataset.i)); });
  addr.addEventListener("blur", () => { setTimeout(closeList, 150); saveDraft(); });
  addr.addEventListener("focus", () => { if (window.innerWidth < 960) setTimeout(() => addr.scrollIntoView({ block: "start", behavior: "smooth" }), 250); });
  $("est-lookup").addEventListener("click", lookup);

  // ---------- Math (mirrors calc_ballpark in the database) ----------
  let calcTimer;
  function compute() {
    const adj = 1 + (state.town ? Number(state.town.travel_adjust_pct) : 3) / 100;
    if (isTierJob()) {
      const t = state.tiers.find((x) => x.job_type === state.job && x.slug === state.tier);
      if (!t) return null;
      const f = state.finishes.find((x) => x.slug === state.finish);
      const m = f ? Number(f.tier_multiplier) || 1 : 1;
      const r10 = (n) => Math.round(n / 10) * 10;
      return { low: r10(t.low * m * adj), high: r10(t.high * m * adj), placeholder: t.is_placeholder };
    }
    const r = state.rates.find((x) => x.job_type === state.job && x.finish_level === state.finish);
    if (!r || !state.size) return null;
    const r100 = (n) => Math.round(n / 100) * 100;
    return {
      low: r100(Math.max(Number(r.minimum_job), r.low_per_unit * state.size) * adj),
      high: r100(Math.max(Number(r.minimum_job), r.high_per_unit * state.size) * adj),
      placeholder: r.is_placeholder,
    };
  }

  function sizeLabel() {
    if (isTierJob()) { const t = state.tiers.find((x) => x.job_type === state.job && x.slug === state.tier); return t ? t.name : "Not set"; }
    return state.size.toLocaleString() + " sq ft";
  }

  function calc() {
    const out = compute();
    const ready = Boolean(out);
    $("est-request-open").disabled = !ready;
    $("est-sample").hidden = !(out && out.placeholder);
    const job = jobOf();
    const fin = state.finishes.find((f) => f.slug === state.finish);
    $("est-summary").innerHTML = [
      ["Where", state.town ? state.town.name : state.geo ? state.geo.place || "Outside area" : "Not set"],
      ["Project", job ? job.name : "Not set"],
      ["Size", sizeLabel()],
      ["Finish", fin ? fin.name : "Not set"],
    ].map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("");
    $("est-restart").hidden = !(state.job || $("est-address").value.trim() || state.town);

    if (!ready) {
      const msg = !state.job ? "Pick a project type" : isTierJob() && !state.tier ? "Pick a job size" : "Answer the questions";
      $("est-range").innerHTML = `<span class="est-dash">${msg}</span>`;
      $("est-bar-fill").style.width = "0%";
      $("est-dock").hidden = true;
      return;
    }
    $("est-range").innerHTML = `<span>${money(out.low)}</span><i>to</i><span>${money(out.high)}</span>`;
    $("est-bar-fill").style.width = Math.min(100, 12 + (Math.log10(out.high) - 2.5) * 20) + "%";
    $("est-dock-range").textContent = `${short(out.low)} to ${short(out.high)}`;
    if ($("req-done").hidden) $("est-dock").hidden = false;
    clearTimeout(calcTimer);
    calcTimer = setTimeout(() => log("info", "estimate.calculate", `${short(out.low)}-${short(out.high)}`, { job: state.job, tier: state.tier, finish: state.finish, size: isTierJob() ? null : state.size, town: state.town && state.town.slug }), 1200);
  }

  // ---------- Remember answers on this device ----------
  const FIELDS = ["req-name", "req-phone", "req-email", "req-contact", "req-timeline", "req-pay", "req-message"];
  let saveTimer;
  function saveDraft() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const d = {
        v: 1, at: Date.now(), address: addr.value, geo: state.geo, town: $("est-town").value,
        job: state.job, finish: state.finish, size: state.size, sizeTouched, tier: state.tier,
        fields: Object.fromEntries(FIELDS.map((id) => [id, $(id).value])),
      };
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch (_) { /* private mode: skip */ }
    }, 300);
  }
  function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (_) {} }

  function restoreDraft() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch (_) { return false; }
    if (!d || d.v !== 1 || Date.now() - d.at > 1000 * 60 * 60 * 24 * 30) { clearDraft(); return false; }
    addr.value = d.address || "";
    if (d.town) setTown(d.town);
    if (d.geo && d.geo.found) showPlace(d.geo, true);
    if (d.finish && state.finishes.some((f) => f.slug === d.finish)) { state.finish = d.finish; markTiles($("est-finishes"), d.finish); }
    sizeTouched = Boolean(d.sizeTouched);
    if (d.size) state.size = Number(d.size);
    state.tier = d.tier || null;
    if (d.job && state.jobs.some((j) => j.slug === d.job)) selectJob(d.job);
    if (!isTierJob() && d.size) setSize(d.size);
    for (const [id, v] of Object.entries(d.fields || {})) if ($(id) && v) $(id).value = v;
    const anything = d.job || d.address || (d.fields && d.fields["req-name"]);
    if (anything) $("est-resume").hidden = false;
    return Boolean(anything);
  }

  function startOver() {
    log("info", "estimate.restart", "Start over");
    clearDraft();
    window.scrollTo({ top: 0 });
    location.reload();
  }
  $("est-restart").addEventListener("click", startOver);
  $("est-resume-reset").addEventListener("click", startOver);
  $("req-again").addEventListener("click", startOver);
  FIELDS.forEach((id) => $(id).addEventListener("input", saveDraft));
  FIELDS.forEach((id) => $(id).addEventListener("change", saveDraft));

  // ---------- Request form ----------
  const reqSec = $("est-request");
  function openRequest() {
    reqSec.hidden = false;
    reqSec.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => { if (!$("req-name").value) $("req-name").focus({ preventScroll: true }); }, 500);
    log("info", "request.open", "Request form opened");
  }
  $("est-request-open").addEventListener("click", openRequest);
  $("est-dock").addEventListener("click", openRequest);

  if ("IntersectionObserver" in window) {
    const seen = new Set();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => (e.isIntersecting ? seen.add(e.target) : seen.delete(e.target)));
      document.body.classList.toggle("est-dock-hide", seen.size > 0);
    }, { threshold: 0.15 });
    io.observe($("est-result")); io.observe(reqSec);
  }

  // Phone: format as they type, require 10 digits
  const phoneEl = $("req-phone");
  function phoneDigits(v) { let d = String(v).replace(/\D/g, ""); if (d.length === 11 && d[0] === "1") d = d.slice(1); return d; }
  phoneEl.addEventListener("input", () => {
    const d = phoneDigits(phoneEl.value).slice(0, 10);
    phoneEl.value = d.length > 6 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d.length > 3 ? `(${d.slice(0, 3)}) ${d.slice(3)}` : d;
  });

  // Photos: shrink on the phone, then show upload status on each one
  const thumbs = $("req-thumbs");
  $("req-photos").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    for (const f of files) {
      if (state.photos.length >= 8) { log("warn", "photo.limit", "Max 8 photos"); break; }
      const blob = await shrink(f);
      const d = document.createElement("div");
      d.className = "est-thumb";
      d.innerHTML = `<img src="${URL.createObjectURL(blob)}" alt="" /><span class="est-thumb__status" aria-hidden="true"></span><button type="button" aria-label="Remove photo">×</button>`;
      const item = { blob, el: d, status: "ready" };
      d.querySelector("button").onclick = () => { state.photos.splice(state.photos.indexOf(item), 1); d.remove(); };
      state.photos.push(item);
      thumbs.appendChild(d);
    }
    log("info", "photo.add", `${state.photos.length} photo(s) attached`);
    e.target.value = "";
  });
  function setThumb(item, status) {
    item.status = status;
    item.el.className = "est-thumb is-" + status;
    const s = item.el.querySelector(".est-thumb__status");
    s.innerHTML = status === "done" ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
      : status === "failed" ? "!" : "";
  }

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

  const err = $("req-error");
  function fail(msg, field) {
    err.textContent = msg; err.hidden = false;
    if (field) { $(field).focus({ preventScroll: true }); $(field).setAttribute("aria-invalid", "true"); }
    err.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  ["req-name", "req-phone", "req-email"].forEach((id) => $(id).addEventListener("input", () => $(id).removeAttribute("aria-invalid")));

  $("req-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("req-submit");
    const name = $("req-name").value.trim(), phone = phoneEl.value.trim(), email = $("req-email").value.trim();
    err.hidden = true;
    if (!name) return fail("Please add your name.", "req-name");
    if (!phone && !email) return fail("Add a phone number or email so we can reach you.", "req-phone");
    if (phone && phoneDigits(phone).length !== 10) return fail("Phone number needs 10 digits, like (520) 555-1234.", "req-phone");
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("That email doesn't look right.", "req-email");

    btn.disabled = true; btn.textContent = "Sending…";
    const out = compute();
    const payload = {
      full_name: name, phone, email, preferred_contact: $("req-contact").value,
      timeline: $("req-timeline").value, payment_plan: $("req-pay").value, message: $("req-message").value.trim(),
      address: addr.value.trim(), job_type: state.job, finish_level: state.finish,
      size_value: isTierJob() ? "" : state.size, size_tier: isTierJob() ? state.tier : "",
      town_id: state.town ? state.town.id : "",
      county: state.geo ? state.geo.county : "", in_city_limits: state.geo ? state.geo.in_city_limits : "",
      latitude: state.geo && state.geo.latitude != null ? state.geo.latitude : "",
      longitude: state.geo && state.geo.longitude != null ? state.geo.longitude : "",
      distance_miles: state.geo ? state.geo.distance_miles : "",
      website: $("req-website").value, elapsed_ms: Date.now() - PAGE_LOADED,
    };
    log("info", "request.submit.start", "Submitting", { job: state.job, photos: state.photos.length, payment: payload.payment_plan });

    const { data: reqId, error } = await sb.rpc("submit_request", { p: payload });
    if (error) {
      log("error", "request.submit.fail", error.message);
      btn.disabled = false; btn.textContent = "Send my request";
      const known = /Too many|Phone number|Email looks|Name is|Phone or email/.test(error.message);
      return fail(known ? error.message : "Something went wrong sending that. Please try again or call us.");
    }
    if (reqId) log("ok", "request.submit.done", "Request saved", { low: out && out.low, high: out && out.high }, reqId);

    // Upload photos with a status on each thumbnail
    let ok = 0;
    if (reqId) {
      thumbs.querySelectorAll("button").forEach((b) => (b.hidden = true));
      for (let i = 0; i < state.photos.length; i++) {
        const item = state.photos[i];
        setThumb(item, "uploading");
        btn.textContent = `Uploading photo ${i + 1} of ${state.photos.length}…`;
        const path = `${reqId}/${Date.now()}-${i}.jpg`;
        const up = await sb.storage.from("request-photos").upload(path, item.blob, { contentType: item.blob.type || "image/jpeg" });
        if (up.error) { setThumb(item, "failed"); log("error", "photo.upload.fail", up.error.message, { i }, reqId); continue; }
        const at = await sb.rpc("attach_photo", { p_request: reqId, p_path: path });
        if (at.error) { setThumb(item, "failed"); log("error", "photo.attach.fail", at.error.message, { i }, reqId); continue; }
        setThumb(item, "done"); ok++;
      }
      if (state.photos.length) {
        log(ok === state.photos.length ? "ok" : "warn", "photo.upload.done", `${ok}/${state.photos.length} uploaded`, null, reqId);
        await new Promise((r) => setTimeout(r, 900)); // let them see the checkmarks
      }
    }

    clearDraft();
    $("req-form").hidden = true;
    const n = state.photos.length;
    const photoLine = !n ? "" : ok === n ? ` We got all ${n} photo${n > 1 ? "s" : ""}.` : ` ${ok} of ${n} photos came through. You can text us the rest.`;
    $("req-done-text").textContent = `Thanks, ${name.split(" ")[0]}. We'll reach out by ${$("req-contact").value} soon to set up a time to see the property.${photoLine}`;
    const done = $("req-done");
    done.hidden = false; done.focus();
    $("est-dock").hidden = true;
  });

  load();
})();
