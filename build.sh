#!/usr/bin/env bash
# Builds the rules engine to WebAssembly, copies it into web/, and builds the server.
set -euo pipefail
cd "$(dirname "$0")"

cargo build --release -p game-wasm --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/game_wasm.wasm web/game.wasm
cargo build --release -p game-server

echo "Built. Start with: ./target/release/game-server   (then open http://localhost:5002)"
