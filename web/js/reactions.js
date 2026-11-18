// Pen-drawn reactions: a little doodle plus a handwritten word, in the sender's ink.
// Same feelings as 😂 🔥 😭 😎, drawn the way you'd scribble them in the margin.

const FACE = `<circle class="r" cx="30" cy="30" r="21"/>`;

export const REACTIONS = [
  {
    kind: "haha",
    label: "Laughing",
    word: "haha!",
    svg:
      FACE +
      `<path class="r" d="M17 25l4-5 4 5M35 25l4-5 4 5"/>` +
      `<path class="r" d="M18 33h24q-2 13-12 13t-12-13z"/>` +
      `<path class="r" d="M10 26q-4 5 0 9M50 26q4 5 0 9"/>`,
  },
  {
    kind: "semma",
    label: "On fire",
    word: "semma!",
    svg:
      `<path class="r" d="M30 5c9 10 17 18 15 31-2 11-9 17-15 17s-14-5-15-15c-1-8 4-13 7-20 2 6 4 8 7 9 2-7 3-14 1-22z"/>` +
      `<path class="r" d="M30 52c-5 0-8-4-7-9 1-4 4-6 5-10 3 4 8 7 8 12 0 4-3 7-6 7z"/>`,
  },
  {
    kind: "ayyo",
    label: "Crying",
    word: "ayyo!",
    svg:
      FACE +
      `<path class="r" d="M17 22q4 5 8 0M35 22q4 5 8 0"/>` +
      `<path class="r" d="M22 42q8-8 16 0"/>` +
      `<path class="r tear" d="M20 27v16M40 27v16"/>`,
  },
  {
    kind: "mass",
    label: "Cool",
    word: "mass!",
    svg:
      FACE +
      `<path class="r" d="M11 23h38"/>` +
      `<path class="r fill" d="M14 23h12q0 9-6 9t-6-9zM34 23h12q0 9-6 9t-6-9z"/>` +
      `<path class="r" d="M22 40q8 5 16-3"/>`,
  },
];

export const byKind = Object.fromEntries(REACTIONS.map((r) => [r.kind, r]));

export function reactionSVG(kind, animate = false) {
  const r = byKind[kind];
  if (!r) return "";
  const body = animate ? r.svg.replaceAll('class="r', 'pathLength="1" class="draw r') : r.svg;
  return `<svg viewBox="0 0 60 60" aria-hidden="true">${body}</svg>`;
}
