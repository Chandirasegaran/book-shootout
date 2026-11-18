// Stick soldier drawn in ballpoint. Faces right; mirrored for the right-hand column.
// viewBox 0 0 100 92. Muzzle at (84, 42).

export const MUZZLE = { x: 84, y: 42 };
export const VIEW = { w: 100, h: 92 };

export function figureSVG(s, { mirror = false, anim = null, label = "" } = {}) {
  const a = (part) => (anim === part ? " draw" : "");
  const pop = (part) => (anim === part ? " pop" : "");
  let g = "";

  if (s.stage === 0 && s.alive) {
    g += `<circle class="ghost" cx="40" cy="22" r="11"/><path class="ghost" d="M40 34V62M40 62L31 82M40 62L49 82"/>`;
  }
  if (s.stage >= 1) g += `<circle class="p${a("head")}" pathLength="1" cx="40" cy="22" r="11"/>`;
  if (s.stage >= 2)
    g += `<path class="p${a("body")}" pathLength="1" d="M40 33V62M40 41L27 54M40 41L57 45M40 62L30 84M40 62L50 84"/>`;
  if (s.stage >= 3)
    g += `<g><circle class="dot${pop("face")}" cx="36" cy="20" r="1.8"/><circle class="dot${pop("face")}" cx="44.5" cy="20" r="1.8"/>` +
      `<path class="p${a("face")}" pathLength="1" style="stroke-width:2.4" d="M35 25.5Q40 30 45.5 25.5"/></g>`;
  if (s.stage >= 4)
    g += `<g class="gun"><path class="p${a("gun")}" pathLength="1" d="M54 39H83V45.5H65L62.5 55H55.5L58 45.5H54Z"/></g>`;
  if (s.loaded) g += `<path class="bullet${pop("bullet")}" d="M88 38.5h6.5a3.2 3.2 0 0 1 0 6.4H88z"/>`;

  let fig = `<g class="figure">${g}</g>`;
  if (!s.alive)
    fig += `<path class="scribble${a("scribble")}" pathLength="1" d="M14 14L84 26L12 38L86 50L14 62L84 74L20 86"/>`;
  if (mirror) fig = `<g transform="translate(100 0) scale(-1 1)">${fig}</g>`;

  const align = mirror ? "xMaxYMid" : "xMinYMid";
  return `<svg class="fig" viewBox="0 0 100 92" preserveAspectRatio="${align} meet" role="img" aria-label="${label}">${fig}</svg>`;
}

export function describe(s, num) {
  if (!s.alive) return `Soldier ${num}, out`;
  const parts = ["nothing drawn yet", "head", "head and body", "head, body and face", "armed with a gun"][s.stage];
  return `Soldier ${num}, ${parts}${s.loaded ? ", loaded" : ""}`;
}
