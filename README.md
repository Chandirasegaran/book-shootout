# Book Shootout

The notebook game from the back bench: flip a book, use the last digit of the page number to draw your soldiers, then shoot. Last soldier standing wins.

Play on one device (pass and play), against the computer (easy, medium or hard), or online with a 4-letter room code. Works on phones, tablets and desktops.

## Run it

### With Docker

```bash
docker build -t book-shootout .
docker run -p 5002:5002 book-shootout
```

### From source

Needs Rust with the `wasm32-unknown-unknown` target (`rustup target add wasm32-unknown-unknown`).

```bash
./build.sh
./target/release/game-server
```

Open http://localhost:5002. To play from a phone on the same Wi-Fi, open `http://<your-computer's-IP>:5002`.

Environment variables: `PORT` (default 5002), `STATIC_DIR` (default `web`).

## How it's built

| Part | What it does |
|---|---|
| `crates/core` | The rules and the computer player, in Rust. One source of truth for every mode. `cargo test -p game-core` |
| `crates/wasm` | Compiles the rules to `web/game.wasm` so local and computer games run in the browser, offline. |
| `crates/server` | axum server: serves `web/`, runs room-code games over WebSocket at `/ws`. The server rolls page numbers, so online games can't be rigged from a browser. |
| `web/` | Plain HTML, CSS and JS modules, no build step. Effects are canvas (tracers, ink splats, confetti) and CSS (pen-drawn strokes, page riffle, screen shake). Sounds are synthesized with Web Audio. |

Rooms close after an hour with no activity. If a player's connection drops, they can rejoin from the home screen.

## Computer levels

| Level | How it plays |
|---|---|
| Easy | Sometimes forgets to shoot, and aims at a random soldier. |
| Medium | Shoots whenever it can, at your most-drawn soldier. |
| Hard | Shoots your biggest threat first, and about half the time peeks at two pages and opens the better one. |

In 400 computer-vs-computer games each: Hard beats Medium 81% of the time, Medium beats Easy 90%.

## Rules

- Each player has soldiers 1, 3, 5, 7 and 9.
- On your turn either **open the book** or **shoot**.
- Only the right-hand page counts, and it's always odd. Its last digit picks the soldier that gets its next drawing: head, body, face, gun, bullet.
- A soldier holds one bullet, and can't fire on the turn it was loaded.
- Shoot any enemy soldier, even a half-drawn one. After firing, land on that number again to reload.
- A soldier that's out is gone for good; landing on its number wastes the turn.

There may be something scribbled in the book, too.
