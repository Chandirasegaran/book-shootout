import { loadEngine, newGame, applyAction, botAction, randomPage } from "./engine.js";
import { figureSVG, describe, MUZZLE, VIEW } from "./figure.js";
import * as fx from "./fx.js";
import * as sound from "./sound.js";
import { Net } from "./net.js";
import { REACTIONS, byKind, reactionSVG } from "./reactions.js";
import { jokeFor } from "./jokes.js";
import { scribbleSVG } from "./scribbles.js";

const NUMS = [1, 3, 5, 7, 9];
const PART_NAME = { head: "a head", body: "a body", face: "a face", gun: "a gun" };
const INK = ["#1f3fa6", "#b3262e"];
const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (o) => structuredClone(o);

const G = {
  mode: null,          // "local" | "bot" | "online"
  state: null,         // latest state from the rules engine / server
  shown: null,         // what is currently drawn on screen
  names: ["", ""],
  online: [true, true],
  rematch: [false, false],
  you: 0,              // my seat in online games
  busy: false,         // an animation is playing
  pending: false,      // waiting for the server to answer my move
  selected: null,      // slot index of my armed shooter
  queue: Promise.resolve(),
  botTimer: null,
  started: false,      // the first page has been opened this game
};

const el = {
  sides: { L: $("sideL"), R: $("sideR") },
  board: $("board"),
  book: $("book"),
  bookHint: $("bookHint"),
  pnumL: $("pnumL"),
  pnumR: $("pnumR"),
  status: $("status"),
  turn: $("turnLabel"),
  result: $("result"),
  rules: $("rules"),
  toast: $("toast"),
};

// ---------------- helpers ----------------
const leftSeat = () => (G.mode === "online" ? G.you : 0);
const sideOf = (seat) => (seat === leftSeat() ? el.sides.L : el.sides.R);
const isMirrored = (seat) => seat !== leftSeat();
const soldierBtn = (seat, slot) => sideOf(seat).querySelector(`[data-slot="${slot}"]`);
const nameOf = (seat) => {
  if (G.mode === "bot") return seat === 0 ? "You" : "Computer";
  if (G.mode === "online" && seat === G.you) return "You";
  return G.names[seat] || `Player ${seat + 1}`;
};
const possessive = (seat) => (nameOf(seat) === "You" ? "Your" : `${nameOf(seat)}'s`);
const canFire = (st, p, i) => {
  const s = st.players[p].soldiers[i];
  return s.alive && s.stage === 4 && s.loaded && s.loaded_turn < st.turn;
};
const humanSeat = (seat) =>
  G.mode === "local" || (G.mode === "bot" && seat === 0) || (G.mode === "online" && seat === G.you);
const canAct = () =>
  G.state && !G.busy && !G.pending && G.state.winner == null && humanSeat(G.state.current) &&
  (G.mode !== "online" || G.names[1] !== "");

function toast(msg, ms = 2400) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toast.t);
  if (ms) toast.t = setTimeout(() => (el.toast.hidden = true), ms);
}
function setStatus(html, seat = null) {
  el.status.innerHTML = html;
  el.status.style.setProperty("--ink", seat == null ? "" : INK[seat]);
}
function show(screen) {
  for (const s of document.querySelectorAll(".screen")) s.classList.toggle("active", s.id === screen);
  document.body.classList.toggle("in-game", screen === "game");
}

function centerOf(node) {
  const r = node.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
function figPoint(seat, slot, px, py) {
  const svg = soldierBtn(seat, slot).querySelector("svg");
  const r = svg.getBoundingClientRect();
  const k = Math.min(r.width / VIEW.w, r.height / VIEW.h);
  // matches preserveAspectRatio xMinYMid (left column) / xMaxYMid (right column)
  const ox = isMirrored(seat) ? r.right - VIEW.w * k : r.left;
  const oy = r.top + (r.height - VIEW.h * k) / 2;
  const x = isMirrored(seat) ? VIEW.w - px : px;
  return { x: ox + x * k, y: oy + py * k };
}

// ---------------- rendering ----------------
function renderSoldier(seat, slot, anim = null) {
  const st = G.shown;
  const s = st.players[seat].soldiers[slot];
  const btn = soldierBtn(seat, slot);
  const ready = s.alive && s.loaded && canFire(st, seat, slot) && st.current === seat && st.winner == null;
  btn.classList.toggle("dead", !s.alive);
  btn.classList.toggle("ready", ready);
  btn.setAttribute("aria-label", describe(s, NUMS[slot]) + (ready ? ", ready to fire" : ""));
  btn.innerHTML =
    `<span class="num">${NUMS[slot]}</span>` +
    figureSVG(s, { mirror: isMirrored(seat), anim, label: describe(s, NUMS[slot]) }) +
    (!s.alive ? `<span class="out-tag">out!</span>` : ready ? `<span class="ready-tag">ready!</span>` : "");
}

function buildSides() {
  for (const seat of [0, 1]) {
    const side = sideOf(seat);
    side.dataset.seat = seat;
    const ol = side.querySelector(".slots");
    ol.innerHTML = "";
    for (let i = 0; i < 5; i++) {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.className = "soldier";
      b.dataset.slot = i;
      b.dataset.seat = seat;
      b.addEventListener("click", () => onSoldier(seat, i));
      li.append(b);
      ol.append(li);
    }
  }
}

function renderAll() {
  const st = G.shown;
  for (const seat of [0, 1]) {
    for (let i = 0; i < 5; i++) renderSoldier(seat, i);
    const side = sideOf(seat);
    const alive = st.players[seat].soldiers.filter((s) => s.alive).length;
    const offline = G.mode === "online" && !G.online[seat] ? ` <span class="off">(away)</span>` : "";
    const level = G.mode === "bot" && seat === 1 ? ` <span class="off">(${G.level})</span>` : "";
    side.querySelector(".pname").innerHTML = escapeHtml(nameOf(seat)) + offline + level;
    side.querySelector(".pmeta").textContent = `${alive} left`;
    side.classList.toggle("active", st.current === seat && st.winner == null);
  }
  refreshControls();
}

function refreshControls() {
  // While an animation plays, label what's on screen rather than the state it is heading to.
  const st = G.shown || G.state;
  const me = canAct();
  el.book.disabled = !me;
  el.book.classList.toggle("waiting", !me);
  el.bookHint.hidden = G.started;
  el.bookHint.textContent = me ? "Tap to open" : "";

  // turn label
  let label = "";
  if (st) {
    if (st.winner != null) label = st.winner === leftSeat() && G.mode !== "local" ? "You won!" : `${nameOf(st.winner)} won`;
    else if (G.mode === "online" && G.names[1] === "") label = "Waiting for your friend";
    else if (G.mode === "bot" && st.current === 1) label = "Computer's turn";
    else label = nameOf(st.current) === "You" ? "Your turn" : `${nameOf(st.current)}'s turn`;
    el.turn.className = "turn p" + (st.winner ?? st.current);
  }
  el.turn.textContent = label;

  // shooter / target affordances
  for (const seat of [0, 1]) {
    for (let i = 0; i < 5; i++) {
      const b = soldierBtn(seat, i);
      if (!b) continue;
      const shooter = me && seat === st.current && canFire(st, seat, i);
      const target = me && G.selected != null && seat !== st.current && st.players[seat].soldiers[i].alive;
      b.classList.toggle("can-act", shooter || target);
      b.classList.toggle("selected", me && seat === st.current && G.selected === i);
      b.classList.toggle("targetable", target);
    }
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function showPage(page) {
  const wrap = (n) => {
    const s = String(n);
    return `${s.slice(0, -1)}<span class="ld">${s.slice(-1)}<svg viewBox="0 0 30 30" preserveAspectRatio="none"><path class="draw" pathLength="1" d="M5 17C3 6 26 2 27 14C28 27 6 29 4 18C3 13 7 8 13 7"/></svg></span>`;
  };
  // Left page is even and never counts; the odd right-hand page does.
  el.pnumL.className = "pnum";
  el.pnumR.className = "pnum chosen";
  el.pnumL.innerHTML = page > 1 ? page - 1 : "";
  el.pnumR.innerHTML = wrap(page);
  showNotes(page);
}
function clearPages() {
  el.pnumL.innerHTML = "";
  el.pnumR.innerHTML = "";
  showNotes(null);
}

// ---------------- easter egg: margin scribbles ----------------
let notesPage = null;
let notesByKeyboard = false;
const peekedBefore = () => {
  try { return localStorage.getItem("bs.peeked") === "1"; } catch { return false; }
};
/** Draw the previous owner's scribbles on the left page of the spread opened at `page`. */
function showNotes(page) {
  if (page === 1) page = null; // page 1 has no left-hand page to scribble on
  notesPage = page;
  const notes = $("notes");
  notes.hidden = page == null;
  notes.classList.remove("fresh");
  if (page == null) return (notes.innerHTML = "");
  notes.innerHTML = scribbleSVG(page - 1);
  // Nudge to get noticed, until the player has opened one once.
  if (!peekedBefore()) notes.classList.add("fresh");
}
function openSticky(e) {
  if (notesPage == null) return;
  notesByKeyboard = e?.detail === 0; // keyboard "clicks" have no click count
  sound.unlock();
  sound.play("pen");
  try { localStorage.setItem("bs.peeked", "1"); } catch {}
  $("notes").classList.remove("fresh");
  $("stickyTitle").textContent = `Scribbled on page ${notesPage - 1}`;
  $("stickyText").textContent = jokeFor(notesPage);
  $("sticky").hidden = false;
  $("stickyClose").focus({ focusVisible: notesByKeyboard });
}
function closeSticky() {
  if ($("sticky").hidden) return;
  $("sticky").hidden = true;
  // Hand focus back for keyboard players only, so mouse and touch users don't get a focus ring.
  if (notesByKeyboard) $("notes").focus();
  else document.activeElement?.blur();
}
$("notes").addEventListener("click", openSticky);
$("stickyClose").addEventListener("click", closeSticky);
$("sticky").addEventListener("click", (e) => e.target === $("sticky") && closeSticky());

// ---------------- game flow ----------------
function startGame(mode, state) {
  clearTimeout(G.botTimer);
  G.mode = mode;
  G.state = state;
  G.shown = clone(state);
  G.selected = null;
  G.busy = false;
  G.pending = false;
  G.started = false;
  G.queue = Promise.resolve();
  el.result.hidden = true;
  $("reacts").hidden = mode === "local";
  clearPages();
  show("game");
  buildSides();
  renderAll();
  greet();
  maybeBot();
}

function greet() {
  const st = G.state;
  if (G.mode === "online" && G.names[1] === "") return setStatus("Waiting for your friend to join.");
  const who = st.current;
  if (nameOf(who) === "You") setStatus("You go first. Tap the book to open it.", who);
  else setStatus(`<b>${escapeHtml(nameOf(who))}</b> goes first.`, who);
}

function act(action) {
  if (!canAct()) return;
  sound.unlock();
  G.selected = null;
  if (G.mode === "online") {
    G.pending = true;
    refreshControls();
    if (action.type === "flip") el.book.classList.add("flipping");
    net.send({ t: "action", action });
    return;
  }
  if (action.type === "flip") action.page = randomPage();
  let res;
  try {
    res = applyAction(G.state, action);
  } catch (e) {
    toast(e.message);
    return;
  }
  G.state = res.state;
  enqueue(res.state, res.events);
}

function enqueue(state, events) {
  G.queue = G.queue.then(() => present(state, events)).catch((e) => console.error(e));
}

async function present(state, events) {
  G.busy = true;
  refreshControls();
  for (const ev of events) await playEvent(ev, state);
  G.shown = clone(state);
  G.busy = false;
  renderAll();
  if (state.winner != null) showResult(state.winner);
  if (G.mode === "bot") botReactTo(events);
  maybeBot();
}

// ---------------- computer's reactions ----------------
const BOT_REPLY = {
  haha: ["haha", "mass", "haha"],
  semma: ["mass", "semma", "haha"],
  ayyo: ["haha", "ayyo", "haha"],
  mass: ["semma", "haha", "mass"],
};
const pickOne = (list) => list[Math.floor(Math.random() * list.length)];
function botReact(kind, delay) {
  setTimeout(() => G.mode === "bot" && floatReaction(1, kind), delay);
}
/** The computer sometimes reacts to what just happened. */
function botReactTo(events) {
  for (const ev of events) {
    if (ev.type === "win") return botReact(ev.player === 1 ? "mass" : "ayyo", 700);
    if (ev.type === "shot") {
      if (ev.player === 1 && Math.random() < 0.6) return botReact(pickOne(["haha", "mass", "semma"]), 350);
      if (ev.player === 0 && Math.random() < 0.65) return botReact("ayyo", 450);
    }
    if (ev.type === "flip" && ev.player === 1 && ev.outcome.kind === "loaded" && Math.random() < 0.3)
      return botReact("semma", 300);
  }
}

async function playEvent(ev, finalState) {
  const sh = G.shown;
  if (ev.type === "flip") {
    G.started = true;
    el.bookHint.hidden = true;
    const p = ev.player;
    el.book.classList.add("flipping");
    showNotes(null);
    closeSticky();
    sound.play("flip");
    await wait(620);
    showPage(ev.page);
    el.book.classList.remove("flipping");
    await wait(420);

    const o = ev.outcome;
    const n = o.slot != null ? NUMS[o.slot] : null;
    const pg = `Page ${ev.page}`;
    if (o.slot != null) {
      const b = soldierBtn(p, o.slot);
      b.classList.add("hit");
      setTimeout(() => b.classList.remove("hit"), 900);
    }
    switch (o.kind) {
      case "dead":
        sound.play("miss");
        el.book.classList.add("bump");
        setTimeout(() => el.book.classList.remove("bump"), 420);
        setStatus(`${pg}. ${possessive(p)} soldier ${n} is already out, so the turn is lost.`, p);
        break;
      case "full":
        sound.play("miss");
        setStatus(`${pg}. ${possessive(p)} soldier ${n} already has its bullet.`, p);
        break;
      case "drew": {
        const s = sh.players[p].soldiers[o.slot];
        s.stage += 1;
        renderSoldier(p, o.slot, o.part);
        sound.play("pen");
        fx.sparkle(centerOf(soldierBtn(p, o.slot).querySelector("svg")), INK[p]);
        setStatus(`${pg}. ${possessive(p)} soldier <b>${n}</b> gets ${PART_NAME[o.part]}.`, p);
        break;
      }
      case "loaded": {
        const s = sh.players[p].soldiers[o.slot];
        s.loaded = true;
        s.loaded_turn = finalState.turn - 1;
        sh.turn = finalState.turn;
        sh.current = finalState.current;
        renderSoldier(p, o.slot, "bullet");
        sound.play("load");
        fx.vibrate(30);
        setStatus(`${pg}. ${possessive(p)} soldier <b>${n}</b> is loaded. It can fire next turn.`, p);
        break;
      }
    }
    await wait(900);
  } else if (ev.type === "shot") {
    const p = ev.player, foe = p ^ 1;
    const shooterBtn = soldierBtn(p, ev.from);
    const targetSvg = soldierBtn(foe, ev.target).querySelector("svg");
    shooterBtn.classList.add("selected");
    await wait(G.mode === "local" || humanSeat(p) ? 80 : 450);
    shooterBtn.classList.add("recoil");
    const from = figPoint(p, ev.from, MUZZLE.x, MUZZLE.y);
    const to = centerOf(targetSvg);
    fx.muzzle(from, isMirrored(p) ? -1 : 1);
    sound.play("shot");
    fx.vibrate([40, 30, 80]);
    await fx.tracer(from, to, INK[p]);
    fx.splat(to, [INK[p], "#343b48", INK[p]]);
    sound.play("hit");
    fx.shake(el.board);
    sh.players[foe].soldiers[ev.target].alive = false;
    sh.players[p].soldiers[ev.from].loaded = false;
    shooterBtn.classList.remove("recoil", "selected");
    renderSoldier(foe, ev.target, "scribble");
    renderSoldier(p, ev.from);
    const fn = escapeHtml(nameOf(foe));
    setStatus(
      `${possessive(p)} soldier ${NUMS[ev.from]} shot ${fn === "You" ? "your" : fn + "'s"} soldier <b>${NUMS[ev.target]}</b>. Out!`,
      p,
    );
    await wait(900);
  } else if (ev.type === "win") {
    await wait(200);
  }
}

function showResult(winner) {
  const meWon = G.mode === "local" ? true : winner === leftSeat();
  const title = $("resultTitle");
  title.className = "p" + winner;
  title.textContent = G.mode === "local" ? `${nameOf(winner)} wins!` : meWon ? "You win!" : `${nameOf(winner)} wins`;
  const left = G.state.players[winner].soldiers.filter((s) => s.alive).length;
  $("resultSub").textContent = `Last one standing with ${left} soldier${left === 1 ? "" : "s"} left.`;
  updateRematchUI();
  setTimeout(() => {
    el.result.hidden = false;
    $("againBtn").focus();
  }, 500);
  if (meWon) {
    sound.play("win");
    fx.confetti([INK[0], INK[1], "#f2c230", "#ffffff", "#9c6b3f"]);
  } else sound.play("lose");
}

function updateRematchUI() {
  const btn = $("againBtn");
  btn.disabled = false;
  btn.textContent = "Play again";
  if (G.mode !== "online") return;
  const me = G.you, them = me ^ 1;
  if (G.rematch[me]) {
    btn.disabled = true;
    btn.textContent = `Waiting for ${G.names[them] || "your friend"}`;
  } else if (G.rematch[them]) {
    btn.textContent = "Accept rematch";
    $("resultSub").textContent = `${G.names[them]} wants to play again.`;
  }
  if (!G.online[them]) $("resultSub").textContent = `${G.names[them] || "Your friend"} has left the room.`;
}

function maybeBot() {
  clearTimeout(G.botTimer);
  const st = G.state;
  if (G.mode !== "bot" || G.busy || st.winner != null || st.current !== 1) return;
  G.botTimer = setTimeout(() => {
    if (G.mode !== "bot" || G.busy) return;
    const action = botAction(G.state, G.level);
    const res = applyAction(G.state, action);
    G.state = res.state;
    enqueue(res.state, res.events);
  }, 750);
}

// ---------------- input ----------------
function onBook() {
  sound.unlock();
  if (!canAct()) {
    if (G.state?.winner == null && !G.busy && !G.pending && G.mode !== "local") toast("Wait for your turn.");
    return;
  }
  act({ type: "flip", page: 1 });
}

function onSoldier(seat, slot) {
  sound.unlock();
  if (!canAct()) return;
  const st = G.state;
  if (seat === st.current) {
    if (canFire(st, seat, slot)) {
      G.selected = G.selected === slot ? null : slot;
      if (G.selected != null) {
        sound.play("select");
        setStatus(`Soldier ${NUMS[slot]} is aiming. Tap an enemy soldier to shoot.`, seat);
      } else setStatus("Tap the book, or pick a loaded soldier to shoot.", seat);
      refreshControls();
    } else if (G.selected != null) {
      G.selected = null;
      refreshControls();
    }
    return;
  }
  if (G.selected == null) {
    const any = [0, 1, 2, 3, 4].some((i) => canFire(st, st.current, i));
    setStatus(any ? "First tap your loaded soldier, then the soldier you want to shoot." : "You need a loaded soldier to shoot. Tap the book.", st.current);
    return;
  }
  if (!st.players[seat].soldiers[slot].alive) return;
  act({ type: "shoot", from: G.selected, target: slot });
}

el.book.addEventListener("click", onBook);
addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!el.rules.hidden) return (el.rules.hidden = true);
    if (!$("sticky").hidden) return closeSticky();
    if (G.selected != null) {
      G.selected = null;
      refreshControls();
    }
  }
});

// ---------------- online ----------------
const net = new Net(onNet, (status) => {
  if (G.mode !== "online") return;
  if (status === "lost") toast("Connection lost. Reconnecting…", 0);
  else if (status === "open" && el.toast.textContent.startsWith("Connection lost")) el.toast.hidden = true;
});

function saveSession(s) {
  try {
    if (s) localStorage.setItem("bs.session", JSON.stringify(s));
    else localStorage.removeItem("bs.session");
  } catch {}
}
function loadSession() {
  try { return JSON.parse(localStorage.getItem("bs.session")); } catch { return null; }
}

function onNet(msg) {
  if (msg.t === "welcome") {
    G.mode = "online";
    G.you = msg.seat;
    saveSession({ code: msg.code, token: msg.token });
    $("lobbyCode").textContent = msg.code;
    return;
  }
  if (msg.t === "error") {
    G.pending = false;
    el.book.classList.remove("flipping");
    if (/closed|not part/.test(msg.msg)) {
      saveSession(null);
      net.close();
      goHome();
      $("homeMsg").textContent = msg.msg;
      $("homeMsg").className = "hint err";
      return;
    }
    if ($("home").classList.contains("active")) {
      $("homeMsg").textContent = msg.msg;
      $("homeMsg").className = "hint err";
      net.close();
    } else toast(msg.msg);
    if (G.state) refreshControls();
    return;
  }
  if (msg.t === "react") return floatReaction(msg.seat, msg.kind);
  if (msg.t !== "state") return;

  const prev = G.state;
  G.names = msg.names;
  G.online = msg.online;
  G.rematch = msg.rematch;
  G.you = msg.you;
  const waiting = msg.names[1] === "";

  if (waiting) {
    G.state = msg.state;
    $("lobbyCode").textContent = loadSession()?.code ?? "----";
    show("lobby");
    return;
  }

  const onGame = $("game").classList.contains("active");
  const fresh = !onGame || !prev || (prev.winner != null && msg.state.winner == null) || msg.state.turn < prev.turn;
  if (fresh) {
    if (!onGame) sound.unlock();
    startGame("online", msg.state);
    G.names = msg.names;
    renderAll();
    greet();
    if (msg.state.winner != null) showResult(msg.state.winner);
    return;
  }

  G.state = msg.state;
  if (msg.events.length) {
    G.pending = false;
    enqueue(msg.state, msg.events);
  } else {
    // names / presence / rematch changed
    if (!G.busy) {
      renderAll();
    }
    if (!el.result.hidden) updateRematchUI();
  }
}

function floatReaction(seat, kind) {
  const r = byKind[kind];
  if (!r || !$("game").classList.contains("active")) return;
  const box = sideOf(seat).querySelector(".slots").getBoundingClientRect();
  const s = document.createElement("div");
  s.className = "float-react";
  s.style.setProperty("--ink", INK[seat]);
  s.innerHTML = reactionSVG(kind, true) + `<span>${r.word}</span>`;
  s.style.left = `${box.left + box.width / 2 - 40 + (Math.random() * 30 - 15)}px`;
  s.style.top = `${box.top + box.height * 0.35}px`;
  s.style.width = "80px";
  document.body.append(s);
  sound.play("pen");
  setTimeout(() => s.remove(), 2300);
}

$("reacts").innerHTML = REACTIONS.map(
  (r) => `<button data-kind="${r.kind}" aria-label="Send ${r.label.toLowerCase()} reaction" title="${r.word}">${reactionSVG(r.kind)}</button>`,
).join("");
let lastReact = 0;
$("reacts").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || Date.now() - lastReact < 800) return;
  lastReact = Date.now();
  sound.unlock();
  const kind = b.dataset.kind;
  if (G.mode === "bot") {
    floatReaction(0, kind);
    botReact(pickOne(BOT_REPLY[kind]), 900 + Math.random() * 700);
  } else net.send({ t: "react", kind });
});

// ---------------- home ----------------
function myName() {
  const n = $("nameInput").value.trim();
  try { localStorage.setItem("bs.name", n); } catch {}
  return n || "Player";
}

function goHome() {
  clearTimeout(G.botTimer);
  G.mode = null;
  G.state = null;
  el.result.hidden = true;
  show("home");
  const s = loadSession();
  $("resumeBox").hidden = !s;
  if (s) $("resumeCode").textContent = s.code;
}

async function ensureEngine() {
  try {
    await loadEngine();
    return true;
  } catch (e) {
    $("homeMsg").textContent = "The game engine didn't load. Refresh the page to try again.";
    $("homeMsg").className = "hint err";
    return false;
  }
}

$("localBtn").addEventListener("click", async () => {
  sound.unlock();
  if (!(await ensureEngine())) return;
  G.names = ["Player 1", "Player 2"];
  startGame("local", newGame(Math.random() < 0.5 ? 0 : 1));
});
$("botBtn").addEventListener("click", async () => {
  sound.unlock();
  if (!(await ensureEngine())) return;
  G.names = ["You", "Computer"];
  startGame("bot", newGame(0));
});

// computer level
const LEVEL_HINT = {
  easy: "Sometimes forgets to shoot, and aims anywhere.",
  medium: "Shoots whenever it can.",
  hard: "Aims at your biggest threat, and gets lucky with the book.",
};
function setLevel(level) {
  if (!LEVEL_HINT[level]) level = "medium";
  G.level = level;
  document.querySelector(`.levels input[value="${level}"]`).checked = true;
  $("levelHint").textContent = LEVEL_HINT[level];
  try { localStorage.setItem("bs.level", level); } catch {}
}
document.querySelector(".levels").addEventListener("change", (e) => setLevel(e.target.value));
try { setLevel(localStorage.getItem("bs.level") || "medium"); } catch { setLevel("medium"); }
$("createBtn").addEventListener("click", () => {
  sound.unlock();
  $("homeMsg").textContent = "";
  saveSession(null);
  net.close();
  net.connect();
  G.mode = "online";
  G.state = null;
  $("lobbyCode").textContent = "----";
  show("lobby");
  net.send({ t: "create", name: myName() });
});
$("joinBtn").addEventListener("click", joinRoom);
$("codeInput").addEventListener("keydown", (e) => e.key === "Enter" && joinRoom());
function joinRoom() {
  sound.unlock();
  const code = $("codeInput").value.trim().toUpperCase();
  if (code.length !== 4) {
    $("homeMsg").textContent = "Room codes have 4 characters.";
    $("homeMsg").className = "hint err";
    return;
  }
  $("homeMsg").textContent = "Joining…";
  $("homeMsg").className = "hint";
  saveSession(null);
  net.close();
  net.connect();
  G.mode = "online";
  G.state = null;
  net.send({ t: "join", code, name: myName() });
}
$("resumeBtn").addEventListener("click", () => {
  sound.unlock();
  const s = loadSession();
  if (!s) return;
  net.close();
  net.session = s;
  G.mode = "online";
  G.state = null;
  net.connect();
});
$("forgetBtn").addEventListener("click", () => {
  saveSession(null);
  $("resumeBox").hidden = true;
});

$("lobbyCancel").addEventListener("click", () => {
  net.close();
  saveSession(null);
  goHome();
});
$("shareBtn").addEventListener("click", async () => {
  const code = $("lobbyCode").textContent;
  const url = `${location.origin}${location.pathname}?room=${code}`;
  try {
    if (navigator.share) await navigator.share({ title: "Book Shootout", text: `Join my Book Shootout room: ${code}`, url });
    else {
      await navigator.clipboard.writeText(url);
      toast("Invite link copied");
    }
  } catch {}
});

// In-game replacement for window.confirm. Resolves true when the player chooses to leave.
function askLeave() {
  const box = $("confirm");
  const opp = G.names[G.you ^ 1] || "Your friend";
  $("confirmText").textContent =
    G.mode === "online"
      ? `${opp} will see that you left. You can rejoin from the menu while the room is open.`
      : "This game will end and won't be saved.";
  box.hidden = false;
  $("confirmNo").focus();
  return new Promise((resolve) => {
    const done = (v) => {
      box.hidden = true;
      $("confirmYes").removeEventListener("click", yes);
      $("confirmNo").removeEventListener("click", no);
      box.removeEventListener("click", outside);
      removeEventListener("keydown", esc, true);
      $("quitBtn").focus();
      resolve(v);
    };
    const yes = () => done(true);
    const no = () => done(false);
    const outside = (e) => e.target === box && done(false);
    const esc = (e) => e.key === "Escape" && (e.stopImmediatePropagation(), done(false));
    $("confirmYes").addEventListener("click", yes);
    $("confirmNo").addEventListener("click", no);
    box.addEventListener("click", outside);
    addEventListener("keydown", esc, true);
  });
}

$("quitBtn").addEventListener("click", async () => {
  if (!$("confirm").hidden) return;
  const live = G.state && G.state.winner == null && G.state.turn > 1;
  if (live && !(await askLeave())) return;
  if (G.mode === "online") {
    net.close();
    saveSession(null);
  }
  goHome();
});
$("homeBtn").addEventListener("click", () => {
  if (G.mode === "online") {
    net.close();
    saveSession(null);
  }
  goHome();
});
$("againBtn").addEventListener("click", () => {
  if (G.mode === "online") {
    net.send({ t: "rematch" });
    G.rematch[G.you] = true;
    updateRematchUI();
    return;
  }
  const names = G.names;
  startGame(G.mode, newGame(G.state.starter ^ 1));
  G.names = names;
});

// rules + sound
const openRules = () => {
  el.rules.hidden = false;
  $("rulesClose").focus();
};
$("rulesBtn").addEventListener("click", openRules);
$("rulesBtnHome").addEventListener("click", openRules);
$("rulesClose").addEventListener("click", () => (el.rules.hidden = true));
el.rules.addEventListener("click", (e) => e.target === el.rules && (el.rules.hidden = true));
const soundBtn = $("soundBtn");
const syncSoundBtn = () => {
  soundBtn.classList.toggle("off", sound.isMuted());
  soundBtn.setAttribute("aria-label", sound.isMuted() ? "Sound off" : "Sound on");
};
soundBtn.addEventListener("click", () => {
  sound.unlock();
  sound.setMuted(!sound.isMuted());
  syncSoundBtn();
});
syncSoundBtn();

// ---------------- boot ----------------
$("titleDoodle").innerHTML = figureSVG({ stage: 4, loaded: true, alive: true, loaded_turn: 0 }, { label: "A stick soldier with a gun" });
try { $("nameInput").value = localStorage.getItem("bs.name") || ""; } catch {}
const roomParam = new URLSearchParams(location.search).get("room");
if (roomParam) {
  $("codeInput").value = roomParam.toUpperCase().slice(0, 4);
  $("homeMsg").textContent = "Write your name, then tap Join.";
  history.replaceState(null, "", location.pathname);
}
goHome();
ensureEngine();
// Open with #debug to poke at the game from the console.
if (location.hash === "#debug") window.__bs = { G, startGame, newGame, applyAction, act };
