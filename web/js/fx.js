// Canvas effects: bullet tracers, muzzle flash, ink splats, paper confetti.
const canvas = document.getElementById("fx");
const ctx = canvas.getContext("2d");
let items = [];
let running = false;
let dpr = 1;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
}
addEventListener("resize", resize);
resize();

function start() {
  if (running) return;
  running = true;
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    items = items.filter((it) => it.step(dt) !== false);
    if (items.length) requestAnimationFrame(frame);
    else {
      running = false;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
    }
  };
  requestAnimationFrame(frame);
}
const add = (it) => { items.push(it); start(); };
const rand = (a, b) => a + Math.random() * (b - a);

/** Bullet flies from a to b; resolves when it lands. */
export function tracer(a, b, color) {
  return new Promise((resolve) => {
    const dur = reduced ? 0.01 : 0.22;
    let t = 0;
    let done = false;
    // Animation frames pause in background tabs; never let the game wait on them.
    setTimeout(() => {
      if (!done) { done = true; resolve(); }
    }, dur * 1000 + 80);
    add({
      step(dt) {
        t += dt;
        const k = Math.min(t / dur, 1);
        const x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k;
        const tail = Math.max(0, k - 0.35);
        const tx = a.x + (b.x - a.x) * tail, ty = a.y + (b.y - a.y) * tail;
        const fade = t > dur ? 1 - (t - dur) / 0.25 : 1;
        if (fade <= 0) return false;
        ctx.globalAlpha = fade;
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.setLineDash([10, 7]);
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        if (k >= 1 && !done) { done = true; resolve(); }
      },
    });
  });
}

export function muzzle(p, dir) {
  let t = 0;
  add({
    step(dt) {
      t += dt;
      if (t > 0.14) return false;
      const r = 18 * (1 - t / 0.14) + 4;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(dir, 1);
      ctx.fillStyle = "#ffcf3f";
      ctx.strokeStyle = "#343b48";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const ang = (i / 10) * Math.PI * 2;
        const rr = i % 2 ? r * 0.45 : r;
        ctx.lineTo(Math.cos(ang) * rr + r * 0.4, Math.sin(ang) * rr * 0.8);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    },
  });
}

/** Ink splat: droplets with gravity plus a few speed lines. */
export function splat(p, colors, n = 26) {
  if (reduced) n = 8;
  for (let i = 0; i < n; i++) {
    const ang = rand(0, Math.PI * 2), sp = rand(80, 360);
    let x = p.x, y = p.y, vx = Math.cos(ang) * sp, vy = Math.sin(ang) * sp - 60, life = rand(0.45, 0.9), t = 0;
    const r = rand(1.5, 4.5), c = colors[i % colors.length];
    add({
      step(dt) {
        t += dt;
        if (t > life) return false;
        vy += 600 * dt; vx *= 0.97;
        x += vx * dt; y += vy * dt;
        ctx.globalAlpha = 1 - t / life;
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      },
    });
  }
  // shock ring
  let t = 0;
  add({
    step(dt) {
      t += dt;
      if (t > 0.35) return false;
      ctx.globalAlpha = 1 - t / 0.35;
      ctx.strokeStyle = colors[0];
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, 10 + t * 160, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    },
  });
}

/** Small pen sparkle where a part was just drawn. */
export function sparkle(p, color) {
  const n = reduced ? 3 : 9;
  for (let i = 0; i < n; i++) {
    const ang = rand(0, Math.PI * 2), sp = rand(30, 110);
    let t = 0;
    const life = rand(0.3, 0.55);
    add({
      step(dt) {
        t += dt;
        if (t > life) return false;
        const d = sp * t;
        ctx.globalAlpha = 1 - t / life;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(ang) * d, p.y + Math.sin(ang) * d);
        ctx.lineTo(p.x + Math.cos(ang) * (d + 6), p.y + Math.sin(ang) * (d + 6));
        ctx.stroke();
        ctx.globalAlpha = 1;
      },
    });
  }
}

/** Torn paper confetti for the win. */
export function confetti(colors) {
  const n = reduced ? 20 : 140;
  for (let i = 0; i < n; i++) {
    let x = rand(0, innerWidth), y = rand(-innerHeight * 0.6, -10);
    let vx = rand(-40, 40), vy = rand(60, 200), rot = rand(0, 6), vr = rand(-6, 6), t = 0;
    const w = rand(6, 12), h = rand(8, 16), c = colors[i % colors.length], life = rand(2.5, 4);
    add({
      step(dt) {
        t += dt;
        if (t > life || y > innerHeight + 30) return false;
        vy += 40 * dt;
        x += vx * dt + Math.sin(t * 3 + i) * 0.6; y += vy * dt; rot += vr * dt;
        ctx.save();
        ctx.translate(x, y); ctx.rotate(rot); ctx.scale(1, Math.cos(t * 5 + i));
        ctx.globalAlpha = Math.min(1, (life - t) * 2);
        ctx.fillStyle = c;
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.restore();
      },
    });
  }
}

export function shake(el) {
  if (reduced) return;
  el.classList.remove("shake");
  void el.offsetWidth;
  el.classList.add("shake");
  setTimeout(() => el.classList.remove("shake"), 450);
}

export function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch {}
}
