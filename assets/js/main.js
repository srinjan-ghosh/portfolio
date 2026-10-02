// Shared behaviour: theme toggle, TOC highlighting, flow-node → step linking, trace replay.
(function () {
  const root = document.documentElement;

  // ---- Theme toggle ----
  try {
    const saved = localStorage.getItem("theme");
    if (saved) root.setAttribute("data-theme", saved);
  } catch (e) { /* storage unavailable */ }

  const toggle = document.querySelector(".theme-toggle");
  const isDark = () => {
    const t = root.getAttribute("data-theme");
    if (t) return t === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  };
  const syncIcon = () => { if (toggle) toggle.textContent = isDark() ? "☀" : "☾"; };
  syncIcon();
  if (toggle) {
    toggle.addEventListener("click", () => {
      const next = isDark() ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch (e) { /* ignore */ }
      syncIcon();
    });
  }

  // ---- Footer year ----
  document.querySelectorAll("[data-year]").forEach((el) => { el.textContent = new Date().getFullYear(); });

  // ---- TOC active section ----
  const tocLinks = document.querySelectorAll(".toc a");
  if (tocLinks.length && "IntersectionObserver" in window) {
    const map = new Map();
    tocLinks.forEach((a) => {
      const target = document.querySelector(a.getAttribute("href"));
      if (target) map.set(target, a);
    });
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          tocLinks.forEach((l) => l.classList.remove("active"));
          map.get(e.target).classList.add("active");
        }
      });
    }, { rootMargin: "-30% 0px -60% 0px" });
    map.forEach((_, section) => obs.observe(section));
  }

  // ---- Clicking a diagram node scrolls to and highlights its step ----
  document.querySelectorAll(".flow-node[data-step]").forEach((node) => {
    node.addEventListener("click", () => {
      const step = document.getElementById(node.dataset.step);
      if (!step) return;
      document.querySelectorAll(".step.highlight").forEach((s) => s.classList.remove("highlight"));
      document.querySelectorAll(".flow-node.active").forEach((n) => n.classList.remove("active"));
      node.classList.add("active");
      step.classList.add("highlight");
      step.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => step.classList.remove("highlight"), 2500);
    });
  });

  // ---- Trace replay ----
  // Expects window.TRACE = [{ kind, label, text, step? }, ...]
  const trace = document.querySelector(".trace");
  if (trace && Array.isArray(window.TRACE)) {
    const body = trace.querySelector(".trace-body");
    const playBtn = trace.querySelector("[data-act=play]");
    const stepBtn = trace.querySelector("[data-act=step]");
    const resetBtn = trace.querySelector("[data-act=reset]");
    const counter = trace.querySelector(".trace-count");
    let i = 0;
    let timer = null;

    const render = () => {
      counter.textContent = `${i} / ${window.TRACE.length}`;
      stepBtn.disabled = i >= window.TRACE.length;
      playBtn.disabled = i >= window.TRACE.length;
    };

    const emit = () => {
      if (i >= window.TRACE.length) { stop(); return; }
      if (i === 0) body.innerHTML = "";
      const ev = window.TRACE[i++];
      const line = document.createElement("div");
      line.className = `trace-line k-${ev.kind}`;
      const kind = document.createElement("span");
      kind.className = "t-kind";
      kind.textContent = `[${ev.label}]`;
      line.appendChild(kind);
      line.appendChild(document.createTextNode(ev.text));
      body.appendChild(line);
      body.scrollTop = body.scrollHeight;
      if (ev.step) {
        document.querySelectorAll(".flow-node.active").forEach((n) => n.classList.remove("active"));
        const node = document.querySelector(`.flow-node[data-step="${ev.step}"]`);
        if (node) node.classList.add("active");
      }
      render();
    };

    const stop = () => {
      clearInterval(timer);
      timer = null;
      playBtn.textContent = "▶ Play";
      render();
    };

    playBtn.addEventListener("click", () => {
      if (timer) { stop(); return; }
      playBtn.textContent = "❚❚ Pause";
      emit();
      timer = setInterval(emit, 1400);
    });
    stepBtn.addEventListener("click", () => { if (timer) stop(); emit(); });
    resetBtn.addEventListener("click", () => {
      stop();
      i = 0;
      body.innerHTML = '<div class="trace-empty">Press ▶ Play to replay an example run, or Step to go one event at a time.</div>';
      document.querySelectorAll(".flow-node.active").forEach((n) => n.classList.remove("active"));
      render();
    });
    render();
  }
})();
