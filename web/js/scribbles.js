// Pencil scribbles on the left-hand page: a few lines of messy "handwriting"
// plus one small doodle. Seeded by page number, so a page always looks the same.
// viewBox 0 0 60 44.

function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** One line of cursive-looking handwriting from x0 to x1 on baseline y. */
function handLine(r, x0, x1, y) {
  const f = (n) => n.toFixed(2);
  let d = `M${f(x0)} ${y}`;
  let x = x0;
  let wordLen = 0;
  while (x < x1 - 3) {
    if (wordLen > 3 && r() < 0.22) {
      // gap between words
      x += 2 + r() * 1.6;
      d += `M${f(x)} ${y}`;
      wordLen = 0;
      continue;
    }
    const pick = r();
    if (pick < 0.18) {
      // tall looped letter (l, h, b): rises, loops back over itself, lands a little further on
      const w = 2 + r() * 0.8, h = 4.2 + r() * 1.6;
      d += `c${f(w * 0.75)} ${f(-h * 0.9)} ${f(w * 0.15)} ${f(-h * 1.15)} ${f(-w * 0.05)} ${f(-h * 0.9)}`;
      d += `c${f(-w * 0.2)} ${f(h * 0.3)} ${f(w * 0.05)} ${f(h * 0.8)} ${f(w * 0.55)} ${f(h * 0.9)}`;
      x += w * 0.5;
    } else if (pick < 0.32) {
      // small round letter (e, o)
      const w = 1.8 + r() * 0.6, h = 1.8 + r() * 0.5;
      d += `c${f(w * 0.9)} ${f(-h * 0.4)} ${f(w * 0.5)} ${f(-h * 1.2)} ${f(w * 0.1)} ${f(-h * 0.8)}`;
      d += `c${f(-w * 0.35)} ${f(h * 0.4)} ${f(w * 0.2)} ${f(h * 0.9)} ${f(w * 0.9)} ${f(h * 0.8)}`;
      x += w;
    } else {
      // rounded hump (n, m, u)
      const w = 1.6 + r() * 1.2, h = 1.6 + r() * 0.9;
      d += `c${f(w * 0.05)} ${f(-h)} ${f(w * 0.95)} ${f(-h)} ${f(w)} 0`;
      x += w;
    }
    wordLen++;
  }
  return d;
}

const DOODLES = [
  // star
  `<path d="M6 0l1.8 4 4.2.4-3.2 2.8 1 4.2L6 9.2 2.2 11.4l1-4.2L0 4.4l4.2-.4z"/>`,
  // heart
  `<path d="M6 10.5C1 7 0 4.5 1.5 2.3 3 .4 5.2 1 6 3c.8-2 3-2.6 4.5-.7C12 4.5 11 7 6 10.5z"/>`,
  // smiley
  `<circle cx="6" cy="6" r="5.5"/><path d="M3.6 4.6h.1M8.3 4.6h.1M3.4 7.4q2.6 2.6 5.2 0"/>`,
  // arrow pointing at the page number
  `<path d="M1 1q5 3 6 9M7 10l-3-1.4M7 10l1.6-2.8"/>`,
  // spiral
  `<path d="M6 6.2c.6 0 .8-.9.1-1.2-1-.4-2 .6-1.6 1.7.5 1.4 2.5 1.6 3.4.4 1.1-1.5.3-3.8-1.6-4.2C3.9 2.4 1.7 4 1.8 6.4c.1 2.8 3 4.6 5.6 3.9 2.7-.7 4.2-3.6 3.4-6.2"/>`,
  // tiny stick soldier
  `<circle cx="5" cy="2.4" r="2"/><path d="M5 4.4v4M5 8.4l-2 3.2M5 8.4l2 3.2M5 5.6l4.6.8M9.2 5.8h2.6"/>`,
  // cloud with rain
  `<path d="M2.5 6.5a2.2 2.2 0 0 1 .6-4.3 3 3 0 0 1 5.6.6 1.9 1.9 0 0 1 .4 3.7zM3.5 8.5l-.6 2M6.5 8.5l-.6 2M9.3 8.5l-.6 2"/>`,
  // flower
  `<circle cx="6" cy="4.5" r="1.3"/><path d="M6 3.2q-1.4-3 0-3.2 1.4.2 0 3.2M7.3 4.5q3-1.4 3.2 0-.2 1.4-3.2 0M6 5.8q1.4 3 0 3.2-1.4-.2 0-3.2M4.7 4.5q-3 1.4-3.2 0 .2-1.4 3.2 0M6 9v3"/>`,
  // question mark
  `<path d="M3 3.5Q3 .5 6 .5t3 3c0 2-3 2.4-3 5M6 11.2v.2"/>`,
  // "100" with underline, like a proud test score
  `<path d="M.5 2.5l1.5-1v8M4.8 5.4a1.8 3.6 0 1 0 3.6 0 1.8 3.6 0 1 0-3.6 0M9.6 5.4a1.8 3.6 0 1 0 3.6 0 1.8 3.6 0 1 0-3.6 0M0 11.3q7-1 13.5 0"/>`,
];

export function scribbleSVG(page) {
  const r = rng(page);
  const lines = 2 + Math.floor(r() * 2); // 2 or 3 lines
  let paths = "";
  for (let i = 0; i < lines; i++) {
    const y = 9 + i * 8.5 + r() * 1.2;
    const x0 = 4 + r() * 3;
    const x1 = i === lines - 1 ? 22 + r() * 22 : 44 + r() * 12;
    paths += `<path class="hand" pathLength="1" style="animation-delay:${(i * 0.18).toFixed(2)}s" d="${handLine(r, x0, x1, y)}"/>`;
  }
  const doodle = DOODLES[Math.floor(r() * DOODLES.length)];
  const dx = 40 + r() * 6, dy = 28 + r() * 3, rot = (r() * 30 - 15).toFixed(0);
  paths += `<g class="doodle" transform="translate(${dx.toFixed(1)} ${dy.toFixed(1)}) rotate(${rot} 6 6)">${doodle}</g>`;
  return `<svg viewBox="0 0 60 44" aria-hidden="true">${paths}</svg>`;
}
