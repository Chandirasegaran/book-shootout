// Loads the Rust rules engine (crates/wasm) and talks to it with JSON.
let wasm = null;
const enc = new TextEncoder();
const dec = new TextDecoder();

export async function loadEngine() {
  if (wasm) return;
  const res = await fetch("game.wasm");
  if (!res.ok) throw new Error("Could not load game.wasm");
  const { instance } = await WebAssembly.instantiate(await res.arrayBuffer(), {});
  wasm = instance.exports;
}

function call(req) {
  const bytes = enc.encode(JSON.stringify(req));
  const ptr = wasm.alloc(bytes.length);
  new Uint8Array(wasm.memory.buffer, ptr, bytes.length).set(bytes);
  const len = wasm.call(ptr, bytes.length);
  wasm.dealloc(ptr, bytes.length);
  const out = new Uint8Array(wasm.memory.buffer, wasm.out_ptr(), len);
  const res = JSON.parse(dec.decode(out));
  if (res.error) throw new Error(res.error);
  return res;
}

// The counted page is the right-hand one, which is always odd: 1, 3, ... 999.
export const randomPage = () => {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return (a[0] % 500) * 2 + 1;
};

export const newGame = (starter) => call({ op: "new", starter }).state;
export const applyAction = (state, action) => call({ op: "apply", state, action });
export const botAction = (state, level = "medium") => {
  const roll = new Uint32Array(1);
  crypto.getRandomValues(roll);
  return call({ op: "bot", state, level, pages: [randomPage(), randomPage()], roll: roll[0] }).action;
};
