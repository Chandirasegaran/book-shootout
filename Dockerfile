# Book Shootout: build the rules engine (WASM) and a fully static server, then ship
# them in an empty `scratch` image: no OS, no shell, just the binary and the web files.
#
#   docker build -t book-shootout .
#   docker run -p 5002:5002 book-shootout
#
# Then open http://localhost:5002

# ---------- build ----------
# Alpine's Rust toolchain targets musl, which links everything statically.
FROM rust:1-alpine AS build
RUN apk add --no-cache musl-dev \
 && rustup target add wasm32-unknown-unknown
WORKDIR /src

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
FROM scratch
COPY --from=build /src/target/release/game-server /game-server
COPY --from=build /src/web /web
ENV PORT=5002 STATIC_DIR=/web
EXPOSE 5002
# Unprivileged user; scratch has no /etc/passwd, so use a numeric id.
USER 10001:10001
ENTRYPOINT ["/game-server"]
