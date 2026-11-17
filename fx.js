/* EarthTrace FX
   1. Space field   — a canvas that sits behind the whole page: three star depths, drifting
                      nebula, distant bodies, dust that reacts to the pointer, click shockwaves.
   2. Choreography  — scroll-linked reveals, in-card parallax, section tone shifts, hero
                      recession, and an altitude rail (the page is a descent from orbit).
   Both respect prefers-reduced-motion. Nothing here touches the app logic in script.js. */
(() => {
  "use strict";
  const doc = document;
  const root = doc.documentElement;
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const wrap = (v, m) => ((v % m) + m) % m;
  const rgb = (c) => `${c[0]},${c[1]},${c[2]}`;

  // Earth palette (bone / moss-sage / sand / clay / ocean)
  const BONE = [236, 232, 214], SAGE = [160, 190, 125], SAND = [222, 193, 136], CLAY = [228, 142, 92], OCEAN = [116, 178, 178];

  // Nebula tint per section: [colour A, colour B]. Lerped as the reader moves through the page.
  const TONES = {
    observatory: [[58, 128, 128], [66, 104, 58]],
    introduction: [[62, 104, 58], [150, 116, 64]],
    discover: [[96, 138, 78], [52, 118, 128]],
    explorer: [[40, 112, 142], [58, 100, 60]],
    theatre: [[156, 82, 46], [150, 118, 66]],
    hydrology: [[30, 102, 118], [52, 128, 128]],
    team: [[150, 110, 70], [58, 98, 56]],
  };

  /* ====================================================================== */
  /* 1. SPACE FIELD                                                         */
  /* ====================================================================== */
  const canvas = doc.createElement("canvas");
  canvas.id = "spaceCanvas";
  canvas.setAttribute("aria-hidden", "true");
  doc.body.prepend(canvas);
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  let W = 0, H = 0, DPR = 1;
  const mouse = { x: -9999, y: -9999, nx: 0, ny: 0, tx: 0, ty: 0, active: false, down: false, touch: false };
  const scroll = { y: window.scrollY, dy: 0, vel: 0 };
  const tone = { a: [...TONES.observatory[0]], b: [...TONES.observatory[1]], ta: TONES.observatory[0], tb: TONES.observatory[1] };
  let stars = [], motes = [], sparks = [], shocks = [], meteor = null, flash = 0;
  let nextMeteor = 5, degraded = false, slowFrames = 0;

  function sprite(color) {
    const size = 64, c = doc.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gr.addColorStop(0, `rgba(${rgb(color)},1)`);
    gr.addColorStop(0.22, `rgba(${rgb(color)},.5)`);
    gr.addColorStop(1, `rgba(${rgb(color)},0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
    return c;
  }
  const SPR = { bone: sprite(BONE), sage: sprite(SAGE), sand: sprite(SAND), clay: sprite(CLAY), ocean: sprite(OCEAN) };
  const SPR_KEYS = ["bone", "sage", "sage", "sand", "ocean", "clay"];

  function pickStarColor() {
    const r = Math.random();
    if (r < 0.7) return BONE;
    if (r < 0.82) return SAGE;
    if (r < 0.92) return SAND;
    if (r < 0.97) return CLAY;
    return OCEAN;
  }

  function seed() {
    const area = W * H;
    const small = W < 700;
    const nStars = clamp(Math.round(area / (small ? 11000 : 8200)), 70, 260);
    const nMotes = clamp(Math.round(area / (small ? 34000 : 21000)), 22, 90);
    stars = Array.from({ length: Math.round(nStars * (degraded ? 0.7 : 1)) }, () => {
      const z = Math.pow(Math.random(), 1.7) * 0.85 + 0.15;
      return { x: Math.random() * W, y: Math.random() * H, z, r: 0.45 + z * 1.25, ph: rand(0, 6.28), sp: rand(0.4, 1.7), c: pickStarColor() };
    });
    motes = Array.from({ length: Math.round(nMotes * (degraded ? 0.6 : 1)) }, () => {
      const z = rand(0.25, 1);
      return { x: Math.random() * W, y: Math.random() * H, vx: rand(-6, 6), vy: rand(-8, 2), z, r: rand(1.2, 3.6) * (0.55 + z * 0.7), ph: rand(0, 6.28), s: SPR_KEYS[Math.floor(Math.random() * SPR_KEYS.length)], glow: 0 };
    });
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 1.5);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    seed();
    if (reduce) requestRender();
  }

  // Distant bodies, parallaxed by scroll so they drift past as the reader descends.
  const BODIES = [
    { x: 0.86, y: 0.2, r: 78, z: 0.1, lit: [230, 150, 100], dark: [58, 28, 18], ring: false, tilt: 0 },
    { x: 0.09, y: 0.64, r: 30, z: 0.17, lit: [170, 198, 130], dark: [24, 38, 22], ring: true, tilt: -0.42 },
    { x: 0.64, y: 0.9, r: 48, z: 0.07, lit: [120, 182, 192], dark: [12, 36, 44], ring: false, tilt: 0 },
  ];
  const BLOBS = [
    { x: 0.18, y: 0.22, r: 0.55, z: 0.1, ph: 0.0, k: 0 },
    { x: 0.8, y: 0.16, r: 0.46, z: 0.14, ph: 1.7, k: 1 },
    { x: 0.55, y: 0.7, r: 0.6, z: 0.08, ph: 3.1, k: 0 },
    { x: 0.1, y: 0.88, r: 0.42, z: 0.18, ph: 4.4, k: 1 },
  ];

  function drawNebula(t) {
    const span = Math.max(W, H);
    for (const b of BLOBS) {
      const cx = b.x * W + Math.sin(t * 0.05 + b.ph) * 60 - mouse.nx * b.z * 90;
      const raw = b.y * H - scroll.y * b.z * 0.5 + Math.cos(t * 0.04 + b.ph) * 50;
      const cy = wrap(raw + H * 0.3, H * 1.6) - H * 0.3;
      const r = b.r * span * 0.6;
      const col = b.k ? tone.b : tone.a;
      const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      gr.addColorStop(0, `rgba(${rgb(col.map(Math.round))},.15)`);
      gr.addColorStop(0.55, `rgba(${rgb(col.map(Math.round))},.045)`);
      gr.addColorStop(1, `rgba(${rgb(col.map(Math.round))},0)`);
      ctx.fillStyle = gr;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  }

  function drawBodies(t) {
    const u = clamp(Math.min(W, H) / 800, 0.6, 1.3);
    const P = H * 2.6;
    BODIES.forEach((b, i) => {
      const r = b.r * u;
      const px = b.x * W + Math.sin(t * 0.03 + i) * 18 - mouse.nx * b.z * 60;
      const py = wrap(b.y * H - scroll.y * b.z * 0.9 + t * 2 * b.z, P) - H * 0.3;
      if (py < -r * 3 || py > H + r * 3) return;
      ctx.save();
      ctx.globalAlpha = 0.36;
      if (b.ring) {
        ctx.save(); ctx.translate(px, py); ctx.rotate(b.tilt); ctx.scale(1, 0.28);
        ctx.strokeStyle = `rgba(${rgb(SAND)},.55)`; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, r * 1.75, Math.PI, Math.PI * 2); ctx.stroke(); // back half
        ctx.restore();
      }
      const gr = ctx.createRadialGradient(px - r * 0.42, py - r * 0.42, r * 0.08, px, py, r * 1.05);
      gr.addColorStop(0, `rgb(${rgb(b.lit)})`);
      gr.addColorStop(0.5, `rgb(${rgb(b.lit.map((v, k) => Math.round((v + b.dark[k]) / 2.4)))})`);
      gr.addColorStop(1, `rgb(${rgb(b.dark)})`);
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(${rgb(b.lit)},.38)`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(px, py, r, -2.3, -0.5); ctx.stroke();
      if (b.ring) {
        ctx.save(); ctx.translate(px, py); ctx.rotate(b.tilt); ctx.scale(1, 0.28);
        ctx.strokeStyle = `rgba(${rgb(SAND)},.7)`; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, r * 1.75, 0, Math.PI); ctx.stroke(); // front half
        ctx.restore();
      }
      ctx.restore();
    });
  }

  function drawStars(t) {
    const streak = clamp(scroll.vel * 0.0006, -2.2, 2.2);
    for (const s of stars) {
      const x = wrap(s.x + t * 3 * s.z - mouse.nx * s.z * 34, W);
      const y = wrap(s.y - scroll.y * s.z * 0.35 + t * 1.5 * s.z - mouse.ny * s.z * 22, H);
      const tw = 0.65 + 0.35 * Math.sin(t * s.sp + s.ph);
      const a = (0.22 + 0.78 * s.z) * tw;
      if (Math.abs(streak) > 0.15) {
        const len = streak * s.z * 20;
        ctx.strokeStyle = `rgba(${rgb(s.c)},${(a * 0.6).toFixed(3)})`;
        ctx.lineWidth = s.r * 0.8;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + len); ctx.stroke();
      } else {
        ctx.fillStyle = `rgba(${rgb(s.c)},${a.toFixed(3)})`;
        ctx.fillRect(x - s.r / 2, y - s.r / 2, s.r, s.r);
      }
    }
  }

  function stepMotes(dt, t) {
    const R = 170;
    for (const m of motes) {
      m.vx += (Math.sin(m.y * 0.004 + t * 0.25 + m.ph) * 6) * dt;
      m.vy += (Math.cos(m.x * 0.004 + t * 0.21 + m.ph) * 6 - 1.4) * dt;
      if (mouse.active) {
        const dx = m.x - mouse.x, dy = m.y - mouse.y, d2 = dx * dx + dy * dy;
        if (d2 < R * R) {
          const d = Math.sqrt(d2) + 0.001, k = 1 - d / R;
          if (mouse.down) { m.vx -= (dx / d) * k * 300 * dt; m.vy -= (dy / d) * k * 300 * dt; }
          else if (d < 85) { m.vx += (dx / d) * k * 560 * dt; m.vy += (dy / d) * k * 560 * dt; }
          else { m.vx += (-dy / d) * k * 70 * dt; m.vy += (dx / d) * k * 70 * dt; }
          m.glow = Math.max(m.glow, k);
        }
      }
      for (const s of shocks) {
        const dx = m.x - s.x, dy = m.y - s.y, d = Math.sqrt(dx * dx + dy * dy) + 0.001;
        const band = Math.abs(d - s.r);
        if (band < 52) {
          const push = (1 - s.age) * (1 - band / 52) * 1100 * dt;
          m.vx += (dx / d) * push; m.vy += (dy / d) * push; m.glow = Math.max(m.glow, 0.9 * (1 - s.age));
        }
      }
      const drag = Math.max(0, 1 - 1.3 * dt);
      m.vx *= drag; m.vy *= drag;
      const sp = Math.hypot(m.vx, m.vy);
      if (sp > 300) { m.vx *= 300 / sp; m.vy *= 300 / sp; }
      m.x += m.vx * dt * (0.45 + m.z * 0.55);
      m.y += m.vy * dt * (0.45 + m.z * 0.55) - scroll.dy * m.z * 0.18;
      m.x = wrap(m.x + 40, W + 80) - 40;
      m.y = wrap(m.y + 40, H + 80) - 40;
      m.glow *= Math.pow(0.04, dt);
    }
  }

  function drawMotes(t) {
    ctx.globalCompositeOperation = "lighter";
    for (const m of motes) {
      const tw = 0.7 + 0.3 * Math.sin(t * 0.8 + m.ph);
      const a = clamp((0.16 + 0.3 * m.z) * tw + m.glow * 0.55, 0, 0.95);
      const size = m.r * (7 + m.glow * 7);
      ctx.globalAlpha = a;
      ctx.drawImage(SPR[m.s], m.x - size / 2, m.y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  function burst(x, y) {
    shocks.push({ x, y, r: 0, age: 0, max: Math.max(W, H) * 0.3 });
    const palette = [CLAY, SAND, SAGE, BONE];
    for (let i = 0; i < 30 && sparks.length < 200; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(110, 430);
      sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: rand(0.5, 1.1), c: palette[Math.floor(Math.random() * palette.length)], w: rand(0.9, 2) });
    }
    flash = 1;
  }

  function stepAndDrawFx(dt) {
    for (let i = shocks.length - 1; i >= 0; i--) {
      const s = shocks[i];
      s.age += dt / 1.15;
      if (s.age >= 1) { shocks.splice(i, 1); continue; }
      s.r = s.max * (1 - Math.pow(1 - s.age, 3));
      ctx.lineWidth = 1 + (1 - s.age) * 2.2;
      ctx.strokeStyle = `rgba(${rgb(SAGE)},${((1 - s.age) * 0.5).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(${rgb(CLAY)},${((1 - s.age) * 0.32).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 0.7, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalCompositeOperation = "lighter";
    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i];
      p.life += dt;
      if (p.life >= p.max) { sparks.splice(i, 1); continue; }
      const drag = Math.max(0, 1 - 3.2 * dt);
      p.vx *= drag; p.vy *= drag;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const a = 1 - p.life / p.max;
      ctx.strokeStyle = `rgba(${rgb(p.c)},${(a * 0.9).toFixed(3)})`;
      ctx.lineWidth = p.w;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045); ctx.stroke();
    }
    if (flash > 0.01 && shocks.length) {
      const s = shocks[shocks.length - 1];
      ctx.globalAlpha = flash * 0.5;
      const size = 200;
      ctx.drawImage(SPR.sand, s.x - size / 2, s.y - size / 2, size, size);
      ctx.globalAlpha = 1;
      flash *= Math.pow(0.001, dt);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function drawMeteor(dt, t) {
    if (!meteor && t > nextMeteor && !reduce) {
      meteor = { x: rand(W * 0.35, W * 1.05), y: rand(-20, H * 0.3), vx: -rand(520, 820), vy: rand(220, 380), age: 0, max: rand(0.55, 0.95) };
      nextMeteor = t + rand(7, 15);
    }
    if (!meteor) return;
    meteor.age += dt;
    meteor.x += meteor.vx * dt; meteor.y += meteor.vy * dt;
    const a = Math.sin(clamp(meteor.age / meteor.max, 0, 1) * Math.PI);
    const len = 150, n = Math.hypot(meteor.vx, meteor.vy);
    const tx = meteor.x - (meteor.vx / n) * len, ty = meteor.y - (meteor.vy / n) * len;
    const gr = ctx.createLinearGradient(meteor.x, meteor.y, tx, ty);
    gr.addColorStop(0, `rgba(${rgb(BONE)},${(a * 0.85).toFixed(3)})`);
    gr.addColorStop(1, `rgba(${rgb(BONE)},0)`);
    ctx.strokeStyle = gr; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(meteor.x, meteor.y); ctx.lineTo(tx, ty); ctx.stroke();
    if (meteor.age > meteor.max) meteor = null;
  }

  function drawHalo() {
    if (!mouse.active || mouse.touch) return;
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = mouse.down ? 0.24 : 0.11;
    const size = mouse.down ? 340 : 260;
    ctx.drawImage(SPR.sage, mouse.x - size / 2, mouse.y - size / 2, size, size);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  let last = performance.now(), t0 = last, emaMs = 16, rendering = false;
  function render(now, forceStatic) {
    const rawDt = forceStatic ? 0 : Math.max(0.001, (now - last) / 1000);
    const dt = clamp(rawDt, 0, 0.05);
    last = now;
    const t = forceStatic ? 0 : (now - t0) / 1000;
    const y = window.scrollY;
    scroll.dy = y - scroll.y;
    scroll.y = y;
    if (rawDt > 0) scroll.vel = lerp(scroll.vel, clamp(scroll.dy / rawDt, -4000, 4000), 1 - Math.exp(-rawDt * 9));
    else scroll.vel = 0;
    mouse.nx = lerp(mouse.nx, mouse.tx, 0.05);
    mouse.ny = lerp(mouse.ny, mouse.ty, 0.05);
    const k = 1 - Math.exp(-dt * 2.2);
    for (let i = 0; i < 3; i++) { tone.a[i] = lerp(tone.a[i], tone.ta[i], k); tone.b[i] = lerp(tone.b[i], tone.tb[i], k); }

    ctx.clearRect(0, 0, W, H);
    drawNebula(t);
    drawBodies(t);
    drawStars(t);
    if (!reduce) { stepMotes(dt, t); }
    drawMotes(t);
    stepAndDrawFx(dt);
    drawMeteor(dt, t);
    drawHalo();

    if (!forceStatic) {
      emaMs = lerp(emaMs, dt * 1000, 0.05);
      slowFrames = emaMs > 26 ? slowFrames + 1 : 0;
      if (!degraded && slowFrames > 120) { degraded = true; seed(); }
    }
  }
  function loop(now) {
    render(now, false);
    choreograph();
    requestAnimationFrame(loop);
  }
  function requestRender() {
    if (rendering) return;
    rendering = true;
    requestAnimationFrame((now) => { rendering = false; render(now, true); choreograph(); });
  }

  /* pointer input ------------------------------------------------------- */
  const interactive = "a,button,input,select,textarea,label,summary,canvas:not(#spaceCanvas),[role=tab],[role=button],.modal-backdrop,.fx-rail";
  window.addEventListener("pointermove", (e) => {
    mouse.x = e.clientX; mouse.y = e.clientY;
    mouse.tx = (e.clientX / W - 0.5) * 2; mouse.ty = (e.clientY / H - 0.5) * 2;
    mouse.active = true; mouse.touch = e.pointerType === "touch";
  }, { passive: true });
  window.addEventListener("pointerdown", (e) => {
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true; mouse.touch = e.pointerType === "touch";
    if (e.target instanceof Element && e.target.closest(interactive)) return;
    mouse.down = true;
    if (!reduce) burst(e.clientX, e.clientY);
  }, { passive: true });
  const release = () => { mouse.down = false; };
  window.addEventListener("pointerup", release, { passive: true });
  window.addEventListener("pointercancel", () => { release(); mouse.active = false; }, { passive: true });
  doc.addEventListener("mouseleave", () => { mouse.active = false; mouse.down = false; });
  window.addEventListener("blur", () => { mouse.active = false; mouse.down = false; });
  window.addEventListener("resize", resize);

  /* ====================================================================== */
  /* 2. SCROLL CHOREOGRAPHY                                                 */
  /* ====================================================================== */
  const SECTION_IDS = ["observatory", "introduction", "discover", "explorer", "theatre", "hydrology", "team"];
  const LABELS = { observatory: "Observatory", introduction: "How it works", discover: "Data detective", explorer: "Earth Explorer", theatre: "Guided studies", hydrology: "Hydrology", team: "Team" };
  const sections = SECTION_IDS.map((id) => doc.getElementById(id)).filter(Boolean);
  const topbar = doc.querySelector(".topbar");
  const hero = doc.getElementById("observatory");
  const heroCopy = doc.querySelector(".hero-copy");
  const heroVisual = doc.querySelector(".hero-visual");

  // Elements that travel against the scroll by a few pixels, creating depth inside cards.
  const PARALLAX = [
    [".feature-card .feature-icon", 22], [".study-card .map-cross", 26], [".team-avatar", 16],
    [".hydro-molecule", 24], [".intro-visual", 14], [".library-strip-header", 8],
  ];
  const parallaxEls = [];
  const visible = new Set();
  const io = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => entries.forEach((en) => { en.isIntersecting ? visible.add(en.target) : visible.delete(en.target); }), { rootMargin: "120px 0px" })
    : null;
  PARALLAX.forEach(([sel, speed]) => doc.querySelectorAll(sel).forEach((el) => {
    el.__fxSpeed = speed; parallaxEls.push(el); io ? io.observe(el) : visible.add(el);
  }));

  // Reveal vocabulary: headings draw in, cards rise out of depth, blocks fade up.
  const REVEALS = [
    [".section-heading, .team-header", "fx-head"],
    [".feature-card, .study-card, .team-card", "fx-card"],
    [".intro-workflow, .library-strip, .hydro-card, .theatre-note, .intro-continue-row, .team-footer-line, .section-intro, .team-intro", "fx-rise"],
  ];
  function tagReveals() {
    if (reduce || !("IntersectionObserver" in window)) return;
    const rio = tagReveals.rio || (tagReveals.rio = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("in"); rio.unobserve(en.target); }
    }), { threshold: 0.14, rootMargin: "0px 0px -7% 0px" }));
    REVEALS.forEach(([sel, cls]) => doc.querySelectorAll(`main ${sel.split(",").map((s) => s.trim()).join(", main ")}`).forEach((el) => {
      if (el.__fxTagged || el.closest("#explorer") || el.closest(".modal-backdrop")) return;
      el.__fxTagged = true;
      el.classList.add(cls);
      const sibs = [...el.parentElement.children].filter((c) => c.classList.contains(cls));
      el.style.setProperty("--i", String(Math.max(0, sibs.indexOf(el))));
      rio.observe(el);
    }));
  }

  // Section rules (a hairline that draws as each section enters) and the altitude rail.
  sections.forEach((s) => { if (!s.querySelector(":scope > .fx-rule")) { const r = doc.createElement("i"); r.className = "fx-rule"; r.setAttribute("aria-hidden", "true"); s.prepend(r); } });
  const rail = doc.createElement("aside");
  rail.className = "fx-rail";
  rail.setAttribute("aria-label", "Page position");
  rail.innerHTML = '<div class="fx-alt"><span>ALT</span><b>408</b><small>KM</small></div><div class="fx-track"><i class="fx-fill"></i></div><div class="fx-name"></div>';
  doc.body.appendChild(rail);
  const altEl = rail.querySelector(".fx-alt b"), fillEl = rail.querySelector(".fx-fill"), nameEl = rail.querySelector(".fx-name"), trackEl = rail.querySelector(".fx-track");
  let railSig = "", activeId = "";

  function rebuildTicks(vis, docH) {
    trackEl.querySelectorAll(".fx-tick").forEach((n) => n.remove());
    const span = Math.max(1, docH - H);
    vis.forEach((s) => {
      const b = doc.createElement("button");
      b.type = "button"; b.className = "fx-tick"; b.dataset.id = s.id;
      b.style.top = `${clamp((s.offsetTop / span) * 100, 0, 100)}%`;
      b.setAttribute("aria-label", LABELS[s.id]);
      b.addEventListener("click", () => s.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }));
      trackEl.appendChild(b);
    });
  }

  let lastHeroP = -1;
  function choreograph() {
    const y = scroll.y;
    const docH = root.scrollHeight;
    topbar && topbar.classList.toggle("scrolled", y > 24);

    // active section + tone
    const vis = sections.filter((s) => !s.hidden && s.offsetParent !== null);
    const line = H * 0.45;
    let current = vis[0] || null, best = Infinity;
    vis.forEach((s) => {
      const r = s.getBoundingClientRect();
      if (r.top <= line && r.bottom > line) { current = s; best = -1; }
      else if (best >= 0) { const d = Math.min(Math.abs(r.top - line), Math.abs(r.bottom - line)); if (d < best) { best = d; current = s; } }
      if (!reduce) {
        const sp = clamp((H - r.top) / (H + r.height), 0, 1);
        const rp = clamp((H * 0.9 - r.top) / (H * 0.45), 0, 1);
        if (Math.abs((s.__sp ?? -1) - sp) > 0.004) { s.__sp = sp; s.style.setProperty("--sp", sp.toFixed(3)); }
        if (Math.abs((s.__rp ?? -1) - rp) > 0.01) { s.__rp = rp; s.style.setProperty("--rp", rp.toFixed(3)); }
      }
    });
    if (current && current.id !== activeId) {
      activeId = current.id;
      const tn = TONES[activeId] || TONES.observatory;
      tone.ta = tn[0]; tone.tb = tn[1];
      doc.body.dataset.tone = activeId;
      nameEl.textContent = LABELS[activeId] || "";
      trackEl.querySelectorAll(".fx-tick").forEach((n) => n.classList.toggle("on", n.dataset.id === activeId));
    }

    // altitude rail
    const sig = vis.map((s) => s.id + ":" + s.offsetTop).join("|") + ":" + docH;
    if (sig !== railSig) { railSig = sig; rebuildTicks(vis, docH); trackEl.querySelectorAll(".fx-tick").forEach((n) => n.classList.toggle("on", n.dataset.id === activeId)); }
    const p = clamp(y / Math.max(1, docH - H), 0, 1);
    altEl.textContent = String(Math.round(408 * Math.pow(1 - p, 1.7))).padStart(3, "0");
    fillEl.style.height = `${(p * 100).toFixed(2)}%`;

    if (reduce) return;

    // hero recedes as the reader leaves orbit
    if (hero) {
      const r = hero.getBoundingClientRect();
      const hp = clamp(-r.top / Math.max(1, r.height), 0, 1);
      if (Math.abs(hp - lastHeroP) > 0.002) {
        lastHeroP = hp;
        if (heroCopy) { heroCopy.style.translate = `0 ${(hp * 70).toFixed(1)}px`; heroCopy.style.opacity = String(clamp(1 - hp * 1.25, 0, 1)); }
        if (heroVisual) { heroVisual.style.translate = `0 ${(hp * 50).toFixed(1)}px`; heroVisual.style.scale = String((1 - hp * 0.14).toFixed(3)); heroVisual.style.opacity = String(clamp(1 - hp * 0.8, 0, 1)); }
      }
    }

    // in-card depth
    visible.forEach((el) => {
      const r = el.getBoundingClientRect();
      const prog = (r.top + r.height / 2 - H / 2) / H;
      el.style.translate = `0 ${(-prog * el.__fxSpeed).toFixed(1)}px`;
    });
  }

  /* boot ---------------------------------------------------------------- */
  resize();
  tagReveals();
  if (!reduce) root.classList.add("fx-ready");
  // Dynamic content (variable cards, studies) arrives after boot; tag it as it appears.
  const main = doc.querySelector("main");
  if (main && "MutationObserver" in window && !reduce) {
    let queued = false;
    new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; tagReveals(); }); }).observe(main, { childList: true, subtree: true });
  }
  if (reduce) { requestRender(); window.addEventListener("scroll", requestRender, { passive: true }); }
  else requestAnimationFrame((n) => { last = n; t0 = n; requestAnimationFrame(loop); });
  window.EarthTraceFX = { burst };
})();
