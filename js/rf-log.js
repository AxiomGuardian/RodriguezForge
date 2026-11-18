/* ============================================================
   Rodriguez Forge: shared Supabase client + activity logger
   Every button, lookup, and error writes a row to activity_log.
   The publishable key is safe in the browser; tables are locked by RLS.
   ============================================================ */
(function () {
  const SUPABASE_URL = "https://njqizzmheordibndyvug.supabase.co";
  const SUPABASE_KEY = "sb_publishable_JN8lhOxsrZD2ewb9lavQ_g_U2JFR6VH";

  const sb = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true } }) : null;

  let session = null;
  try { session = sessionStorage.getItem("rf-session"); } catch (_) {}
  if (!session) {
    session = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).slice(0, 36);
    try { sessionStorage.setItem("rf-session", session); } catch (_) {}
  }

  const page = location.pathname.split("/").pop() || "index.html";
  const recent = new Map(); // dedupe identical events within 1.5s

  async function log(level, event, message, details, requestId) {
    const key = level + event + message;
    const now = Date.now();
    if (recent.has(key) && now - recent.get(key) < 1500) return;
    recent.set(key, now);
    const tag = level === "error" ? "color:#e36b2c" : level === "ok" ? "color:#4caf7a" : "color:#4169e1";
    console.log(`%c[RF ${level}] ${event}`, tag, message || "", details || "");
    if (!sb) return;
    try {
      await sb.rpc("log_event", {
        p_level: level, p_event: event, p_page: page, p_session: session,
        p_message: message ? String(message).slice(0, 1000) : null,
        p_details: details || null, p_request: requestId || null,
        p_user_agent: navigator.userAgent,
      });
    } catch (_) { /* logging must never break the page */ }
  }

  window.addEventListener("error", (e) => log("error", "js.error", e.message, { file: e.filename, line: e.lineno, col: e.colno }));
  window.addEventListener("unhandledrejection", (e) => log("error", "js.promise", String(e.reason && e.reason.message || e.reason)));

  window.RF = { sb, log, session, SUPABASE_URL, SUPABASE_KEY };
  if (!sb) console.error("[RF] Supabase library failed to load");
})();
