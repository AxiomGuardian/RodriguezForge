/* Rodriguez Forge — site interactions */
(function () {
  "use strict";

  const prefersReduced =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const header = document.querySelector(".site-header");
  const toggle = document.querySelector(".nav__toggle");
  const mobile = document.querySelector(".nav__mobile");
  const yearEls = document.querySelectorAll("[data-year]");
  const scrollHint = document.querySelector(".hero__scroll");
  const GRID_CELL = 80;

  yearEls.forEach((el) => {
    el.textContent = String(new Date().getFullYear());
  });

  /* Site-wide phone / email from js/site-config.js */
  (function applySiteConfig() {
    const cfg = window.RF_SITE || {};
    const phone = (cfg.phone || "").trim();
    const phoneTel = (cfg.phoneTel || "").trim();
    const email = (cfg.email || "hello@rodriguezforge.com").trim();
    const emailHref = (cfg.emailHref || "mailto:" + email).trim();
    const hasPhone = Boolean(phone && phoneTel);

    document.querySelectorAll('[data-rf="phone"]').forEach((el) => {
      el.textContent = hasPhone ? phone : "Request a call";
    });
    document.querySelectorAll('[data-rf="phone-link"]').forEach((el) => {
      el.setAttribute("href", hasPhone ? phoneTel : "contact.html");
      if (hasPhone) el.setAttribute("aria-label", "Call " + phone);
    });
    document.querySelectorAll('[data-rf="email"]').forEach((el) => {
      el.textContent = email;
    });
    document.querySelectorAll('[data-rf="email-link"]').forEach((el) => {
      el.setAttribute("href", emailHref);
    });
    document.querySelectorAll('[data-rf="location"]').forEach((el) => {
      if (cfg.location) el.textContent = cfg.location;
    });
  })();

  /* Sticky header + hide scroll hint after user scrolls */
  const onScroll = () => {
    const y = window.scrollY || 0;
    if (header) header.classList.toggle("is-scrolled", y > 16);
    if (scrollHint) scrollHint.classList.toggle("is-hidden", y > 40);
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* Mobile nav */
  if (toggle && mobile) {
    const setOpen = (open) => {
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      mobile.classList.toggle("is-open", open);
      document.body.style.overflow = open ? "hidden" : "";
    };

    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") !== "true";
      setOpen(open);
    });

    mobile.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => setOpen(false));
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setOpen(false);
    });
  }

  /* Scroll reveal */
  const reveals = document.querySelectorAll(".reveal");
  if (reveals.length && "IntersectionObserver" in window && !prefersReduced) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add("is-visible"));
  }

  /* Contact form */
  const form = document.querySelector("#project-form");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const success = form.querySelector(".form-success");
      if (success) {
        success.classList.add("is-visible");
        success.setAttribute("tabindex", "-1");
        success.focus();
      }
      form.reset();
    });
  }

  /* Active nav */
  const path = window.location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll("[data-nav]").forEach((link) => {
    const href = link.getAttribute("href");
    if (!href) return;
    const file = href.split("/").pop();
    if (file === path || (path === "" && file === "index.html")) {
      link.classList.add("is-active");
    }
  });

  /**
   * Grid-locked traces: exact horizontal lines of the 80px grid.
   * Pair: one upper, ~0.5s later one lower. A bit more frequent.
   */
  function seedHeroFx() {
    const fx = document.querySelector(".hero__fx");
    if (!fx || prefersReduced) return;

    const spawnOnRow = (rowIndex, delayMs) => {
      const line = document.createElement("span");
      line.className = "warp-line";
      // Snap to horizontal grid line (center of 2px streak on the 1px row)
      line.style.top = rowIndex * GRID_CELL - 0.5 + "px";
      line.style.setProperty("--dur", "2.45s");
      line.style.setProperty("--delay", delayMs + "ms");
      fx.appendChild(line);
      // Keep in DOM until soft fade fully completes
      window.setTimeout(() => line.remove(), 3200 + delayMs);
    };

    const firePair = () => {
      const h = fx.clientHeight || window.innerHeight;
      // Only upper ~75% of hero (where grid is visible)
      const maxY = h * 0.72;
      const maxRow = Math.max(3, Math.floor(maxY / GRID_CELL) - 1);
      if (maxRow < 4) return;

      // Upper third of visible rows
      const topMin = 1;
      const topMax = Math.max(topMin + 1, Math.floor(maxRow * 0.38));
      // Lower third of visible rows
      const botMin = Math.floor(maxRow * 0.55);
      const botMax = maxRow;

      const topRow =
        topMin + Math.floor(Math.random() * Math.max(1, topMax - topMin + 1));
      let botRow =
        botMin + Math.floor(Math.random() * Math.max(1, botMax - botMin + 1));
      if (botRow <= topRow) botRow = Math.min(maxRow, topRow + 2);

      spawnOnRow(topRow, 0);
      spawnOnRow(botRow, 480);
    };

    window.setTimeout(firePair, 700);
    window.setInterval(firePair, 2600);
  }

  seedHeroFx();

  /* ---------- Typewriter for page H1 titles ---------- */
  function typeTitle(el) {
    if (!el || prefersReduced) return;

    const raw =
      el.getAttribute("data-type") ||
      el.innerHTML
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+\n/g, "\n")
        .trim();

    const lines = raw.split(/\n|\|/).map((s) => s.trim()).filter(Boolean);
    el.setAttribute("aria-label", lines.join(" "));
    el.innerHTML = "";
    el.classList.add("is-typing");

    let lineIdx = 0;
    let charIdx = 0;

    const cursor = () => '<span class="type-cursor" aria-hidden="true"></span>';

    const render = () => {
      let html = "";
      for (let li = 0; li < lines.length; li++) {
        if (li > 0) html += "<br />";
        if (li < lineIdx) {
          html += lines[li];
        } else if (li === lineIdx) {
          html += lines[li].slice(0, charIdx) + cursor();
        }
      }
      el.innerHTML = html;
    };

    const step = () => {
      if (lineIdx >= lines.length) {
        // Final frame without cursor; optional highlight word (e.g. FORGE)
        let done = lines.join("<br />");
        const hi = el.getAttribute("data-highlight");
        if (hi) {
          const re = new RegExp("(" + hi.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "i");
          done = done.replace(re, "<em>$1</em>");
        }
        el.innerHTML = done;
        el.classList.remove("is-typing");
        return;
      }

      const line = lines[lineIdx];
      if (charIdx <= line.length) {
        render();
        charIdx += 1;
        window.setTimeout(step, 28 + Math.random() * 22);
      } else {
        lineIdx += 1;
        charIdx = 0;
        window.setTimeout(step, 180);
      }
    };

    window.setTimeout(step, 280);
  }

  function runPageTitleTypes() {
    document.querySelectorAll(".js-type-title").forEach((el) => typeTitle(el));
  }

  /* Reveal site content smoothly */
  function revealSite() {
    document.body.classList.add("is-ready");
    runPageTitleTypes();
  }

  /**
   * Intro sequence:
   * 1) Emblem + type RODRIGUEZ FORGE
   * 2) Orange bar draws
   * 3) Brief hold (~1s)
   * 4) Crossfade: intro fades out WHILE page fades in (no black gap)
   */
  function runIntro() {
    const intro = document.querySelector(".site-intro");
    if (!intro) {
      if (prefersReduced) {
        revealSite();
      } else {
        requestAnimationFrame(() => requestAnimationFrame(revealSite));
      }
      return;
    }

    if (prefersReduced) {
      intro.classList.add("is-done");
      intro.setAttribute("aria-hidden", "true");
      revealSite();
      return;
    }

    // Returning visit: no intro hold, soft page in only
    if (sessionStorage.getItem("rf-intro") === "1") {
      intro.classList.add("is-done");
      intro.setAttribute("aria-hidden", "true");
      requestAnimationFrame(() => requestAnimationFrame(revealSite));
      return;
    }

    document.body.classList.add("is-intro-locked");
    const typeEl = intro.querySelector(".site-intro__type");
    const lineEl = intro.querySelector(".site-intro__line");
    const text = "RODRIGUEZ FORGE";
    let i = 0;

    const dismiss = () => {
      sessionStorage.setItem("rf-intro", "1");
      // Start both at the same frame → true crossfade, no black pause
      revealSite();
      intro.classList.add("is-done");
      window.setTimeout(() => {
        document.body.classList.remove("is-intro-locked");
        intro.setAttribute("aria-hidden", "true");
      }, 1200);
    };

    window.setTimeout(() => {
      const tick = () => {
        if (i <= text.length) {
          typeEl.innerHTML =
            text.slice(0, i) + '<span class="cursor" aria-hidden="true"></span>';
          i += 1;
          window.setTimeout(tick, 48 + Math.random() * 24);
        } else {
          if (lineEl) lineEl.classList.add("is-on");
          // ~1s hold after bar, then crossfade (not 2s+ black)
          window.setTimeout(dismiss, 1000);
        }
      };
      tick();
    }, 450);
  }

  runIntro();
})();
