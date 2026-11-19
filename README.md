# Book Shootout

The notebook game from the back bench: flip a book, use the last digit of the page number to draw your soldiers, then shoot. Last soldier standing wins.

Play on one device (pass and play), against the computer (easy, medium or hard), or online with a 4-letter room code. Works on phones, tablets and desktops.

## Run it

### With Docker

The image is about 3 MB: a static Rust binary and the web files on `scratch`.

```bash
docker run -p 5002:5002 chandirasegaran/book-shootout
```

Or build it yourself:

```bash
docker build -t book-shootout .
docker run -p 5002:5002 book-shootout
```

### On a server, with Docker Compose

Copy `compose.yaml`, `Caddyfile` and `.env.example` to the server.

Plain HTTP on port 5002:

```bash
docker compose up -d
```

HTTPS on your own domain: point the domain's DNS at the server, open ports 80 and 443, then:

```bash
cp .env.example .env    # set DOMAIN=your.domain
docker compose --profile https up -d
```

Caddy gets and renews the certificate and passes the game's WebSocket through. HTTPS is worth it for online play: browsers only allow the "Share invite link" button on secure pages.

The game container runs read-only, with no extra privileges, a 64 MB memory cap and rotated logs. Update with `docker compose pull && docker compose up -d`.

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
| Easy | Shoots a random soldier. |
| Medium | Shoots your most-drawn soldier. |
| Hard | Shoots your biggest threat first, and about half the time peeks at two pages and opens the better one. |

In 400 computer-vs-computer games each: Hard beats Medium 85% of the time, Medium beats Easy 69%.

## Rules

- Each player has soldiers 1, 3, 5, 7 and 9.
- On your turn, open the book. Only the right-hand page counts, and it's always odd. Its last digit picks one of your soldiers.
- That soldier gets its next step: head, body, face, gun, bullet.
- If it already has a bullet, it fires: pick any enemy soldier to shoot, even a half-drawn one. The next landing on that number reloads it.
- A soldier only fires when the page lands on its number.
- A soldier that's out is gone for good; landing on its number wastes the turn.
- Last player with a soldier standing wins.

There may be something scribbled in the book, too.
