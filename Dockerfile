# Book Shootout: build the rules engine (WASM) and the server, then ship a small runtime image.
#
#   docker build -t book-shootout .
#   docker run -p 5002:5002 book-shootout
#
# Then open http://localhost:5002

# ---------- build ----------
FROM rust:1-slim-bookworm AS build
WORKDIR /src
RUN rustup target add wasm32-unknown-unknown

# Cache dependencies: build once with the manifests and empty sources.
COPY Cargo.toml Cargo.lock ./
COPY crates/core/Cargo.toml crates/core/
COPY crates/server/Cargo.toml crates/server/
COPY crates/wasm/Cargo.toml crates/wasm/
RUN mkdir -p crates/core/src crates/server/src crates/wasm/src \
 && echo "" > crates/core/src/lib.rs \
 && echo "fn main() {}" > crates/server/src/main.rs \
 && echo "" > crates/wasm/src/lib.rs \
 && cargo build --release -p game-server \
 && cargo build --release -p game-wasm --target wasm32-unknown-unknown \
 && rm -rf crates/*/src

# Real build.
COPY crates crates
RUN touch crates/*/src/*.rs \
 && cargo build --release -p game-wasm --target wasm32-unknown-unknown \
 && cargo build --release -p game-server

COPY web web
RUN cp target/wasm32-unknown-unknown/release/game_wasm.wasm web/game.wasm

# ---------- run ----------
FROM debian:bookworm-slim
RUN useradd --system --uid 10001 game
WORKDIR /app
COPY --from=build /src/target/release/game-server /app/game-server
COPY --from=build /src/web /app/web
ENV PORT=5002 STATIC_DIR=/app/web
EXPOSE 5002
USER game
CMD ["/app/game-server"]
