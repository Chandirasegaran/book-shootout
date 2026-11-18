//! Book Shootout server: serves the web client and runs room-code games over WebSocket.
//! The server owns the dice (page numbers) so online games can't be rigged from a browser.

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
    routing::get,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use game_core::{Action, Event, Game, MAX_PAGE};
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};
use tower_http::services::ServeDir;

const CODE_CHARS: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_IDLE_LIMIT: Duration = Duration::from_secs(60 * 60);
const MAX_NAME: usize = 16;
/// Pen-drawn reactions players can send (see web/js/reactions.js).
const REACTIONS: [&str; 4] = ["haha", "semma", "ayyo", "mass"];

struct Seat {
    token: String,
    name: String,
    tx: Option<UnboundedSender<String>>,
    conn: u64,
    wants_rematch: bool,
}

struct Room {
    game: Game,
    seats: [Option<Seat>; 2],
    touched: Instant,
}

#[derive(Clone, Default)]
struct App {
    rooms: Arc<Mutex<HashMap<String, Room>>>,
    next_conn: Arc<AtomicU64>,
}

#[derive(Deserialize)]
#[serde(tag = "t", rename_all = "lowercase")]
enum ClientMsg {
    Create { name: String },
    Join { code: String, name: String },
    Rejoin { code: String, token: String },
    Action { action: Action },
    Rematch,
    React { kind: String },
    Leave,
}

#[derive(Serialize)]
#[serde(tag = "t", rename_all = "lowercase")]
enum ServerMsg<'a> {
    Welcome { code: &'a str, seat: u8, token: &'a str },
    State {
        state: &'a Game,
        events: &'a [Event],
        names: [&'a str; 2],
        online: [bool; 2],
        rematch: [bool; 2],
        you: u8,
    },
    React { seat: u8, kind: &'a str },
    Error { msg: &'a str },
}

fn send(tx: &UnboundedSender<String>, msg: &ServerMsg) {
    if let Ok(s) = serde_json::to_string(msg) {
        let _ = tx.send(s);
    }
}

fn random_token() -> String {
    let mut rng = rand::thread_rng();
    (0..24).map(|_| format!("{:x}", rng.gen_range(0..16u8))).collect()
}

fn clean_name(name: &str, fallback: &str) -> String {
    let n: String = name.trim().chars().filter(|c| !c.is_control()).take(MAX_NAME).collect();
    if n.is_empty() { fallback.to_string() } else { n }
}

impl Room {
    fn broadcast(&self, events: &[Event]) {
        let names = [
            self.seats[0].as_ref().map(|s| s.name.as_str()).unwrap_or(""),
            self.seats[1].as_ref().map(|s| s.name.as_str()).unwrap_or(""),
        ];
        let online = [0, 1].map(|i| self.seats[i].as_ref().is_some_and(|s| s.tx.is_some()));
        let rematch = [0, 1].map(|i| self.seats[i].as_ref().is_some_and(|s| s.wants_rematch));
        for (i, seat) in self.seats.iter().enumerate() {
            if let Some(tx) = seat.as_ref().and_then(|s| s.tx.as_ref()) {
                send(
                    tx,
                    &ServerMsg::State { state: &self.game, events, names, online, rematch, you: i as u8 },
                );
            }
        }
    }
}

#[tokio::main]
async fn main() {
    let app_state = App::default();

    // Drop rooms nobody has touched for an hour.
    let rooms = app_state.rooms.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(300));
        loop {
            tick.tick().await;
            rooms.lock().unwrap().retain(|_, r| r.touched.elapsed() < ROOM_IDLE_LIMIT);
        }
    });

    let static_dir = std::env::var("STATIC_DIR").unwrap_or_else(|_| "web".into());
    let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(5002);

    let router = Router::new()
        .route("/ws", get(ws_upgrade))
        .fallback_service(ServeDir::new(&static_dir))
        .with_state(app_state);

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await.expect("bind port");
    println!("Book Shootout running on http://localhost:{port} (serving {static_dir})");
    axum::serve(listener, router).await.expect("server");
}

async fn ws_upgrade(ws: WebSocketUpgrade, State(app): State<App>) -> impl IntoResponse {
    ws.max_message_size(16 * 1024).on_upgrade(move |socket| client(socket, app))
}

async fn client(socket: WebSocket, app: App) {
    let conn = app.next_conn.fetch_add(1, Ordering::Relaxed);
    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = unbounded_channel::<String>();

    let writer = tokio::spawn(async move {
        while let Some(text) = rx.recv().await {
            if sink.send(Message::Text(text.into())).await.is_err() {
                break;
            }
        }
    });

    // (room code, seat) once this connection has a seat.
    let mut joined: Option<(String, u8)> = None;

    while let Some(Ok(msg)) = stream.next().await {
        let Message::Text(text) = msg else { continue };
        let Ok(msg) = serde_json::from_str::<ClientMsg>(&text) else {
            send(&tx, &ServerMsg::Error { msg: "Message not understood." });
            continue;
        };
        handle(&app, conn, &tx, &mut joined, msg);
    }

    // Disconnected: free the line but keep the seat so the player can rejoin.
    if let Some((code, seat)) = joined {
        let mut rooms = app.rooms.lock().unwrap();
        if let Some(room) = rooms.get_mut(&code) {
            if let Some(s) = room.seats[seat as usize].as_mut() {
                if s.conn == conn {
                    s.tx = None;
                }
            }
            room.broadcast(&[]);
        }
    }
    writer.abort();
}

fn handle(
    app: &App,
    conn: u64,
    tx: &UnboundedSender<String>,
    joined: &mut Option<(String, u8)>,
    msg: ClientMsg,
) {
    let mut rooms = app.rooms.lock().unwrap();
    let err = |m: &str| send(tx, &ServerMsg::Error { msg: m });

    match msg {
        ClientMsg::Create { name } => {
            let mut rng = rand::thread_rng();
            let code = loop {
                let c: String =
                    (0..4).map(|_| CODE_CHARS[rng.gen_range(0..CODE_CHARS.len())] as char).collect();
                if !rooms.contains_key(&c) {
                    break c;
                }
            };
            let token = random_token();
            let room = Room {
                game: Game::new(rng.gen_range(0..2)),
                seats: [
                    Some(Seat {
                        token: token.clone(),
                        name: clean_name(&name, "Player 1"),
                        tx: Some(tx.clone()),
                        conn,
                        wants_rematch: false,
                    }),
                    None,
                ],
                touched: Instant::now(),
            };
            send(tx, &ServerMsg::Welcome { code: &code, seat: 0, token: &token });
            room.broadcast(&[]);
            rooms.insert(code.clone(), room);
            *joined = Some((code, 0));
        }
        ClientMsg::Join { code, name } => {
            let code = code.trim().to_uppercase();
            let Some(room) = rooms.get_mut(&code) else {
                return err("No room with that code. Check the code and try again.");
            };
            if room.seats[1].is_some() {
                return err("That room already has two players.");
            }
            let token = random_token();
            room.seats[1] = Some(Seat {
                token: token.clone(),
                name: clean_name(&name, "Player 2"),
                tx: Some(tx.clone()),
                conn,
                wants_rematch: false,
            });
            room.touched = Instant::now();
            send(tx, &ServerMsg::Welcome { code: &code, seat: 1, token: &token });
            room.broadcast(&[]);
            *joined = Some((code, 1));
        }
        ClientMsg::Rejoin { code, token } => {
            let code = code.trim().to_uppercase();
            let Some(room) = rooms.get_mut(&code) else {
                return err("That room has closed. Start a new one.");
            };
            let Some(seat) = (0..2).find(|&i| room.seats[i].as_ref().is_some_and(|s| s.token == token))
            else {
                return err("You are not part of that room.");
            };
            let s = room.seats[seat].as_mut().unwrap();
            s.tx = Some(tx.clone());
            s.conn = conn;
            room.touched = Instant::now();
            send(tx, &ServerMsg::Welcome { code: &code, seat: seat as u8, token: &token });
            room.broadcast(&[]);
            *joined = Some((code, seat as u8));
        }
        ClientMsg::Action { action } => {
            let Some((code, seat)) = joined.as_ref() else { return err("Join a room first.") };
            let Some(room) = rooms.get_mut(code) else { return err("That room has closed.") };
            if room.seats[1].is_none() {
                return err("Wait for your opponent to join.");
            }
            if room.game.current != *seat {
                return err("It's not your turn.");
            }
            // The server rolls the page; whatever the browser sent is ignored.
            let action = match action {
                // Right-hand pages are odd: 1, 3, ... MAX_PAGE.
                Action::Flip { .. } => {
                    Action::Flip { page: rand::thread_rng().gen_range(0..=MAX_PAGE / 2) * 2 + 1 }
                }
                shoot => shoot,
            };
            match room.game.apply(&action) {
                Ok(events) => {
                    room.touched = Instant::now();
                    room.broadcast(&events);
                }
                Err(e) => err(&e.to_string()),
            }
        }
        ClientMsg::Rematch => {
            let Some((code, seat)) = joined.as_ref() else { return };
            let Some(room) = rooms.get_mut(code) else { return };
            if room.game.winner.is_none() {
                return;
            }
            if let Some(s) = room.seats[*seat as usize].as_mut() {
                s.wants_rematch = true;
            }
            let both = room.seats.iter().all(|s| s.as_ref().is_some_and(|s| s.wants_rematch));
            if both {
                room.game = room.game.rematch();
                for s in room.seats.iter_mut().flatten() {
                    s.wants_rematch = false;
                }
            }
            room.broadcast(&[]);
        }
        ClientMsg::React { kind } => {
            let Some((code, seat)) = joined.as_ref() else { return };
            let Some(room) = rooms.get(code) else { return };
            if !REACTIONS.contains(&kind.as_str()) {
                return;
            }
            for s in room.seats.iter().flatten() {
                if let Some(t) = &s.tx {
                    send(t, &ServerMsg::React { seat: *seat, kind: &kind });
                }
            }
        }
        ClientMsg::Leave => {
            if let Some((code, seat)) = joined.take() {
                if let Some(room) = rooms.get_mut(&code) {
                    if let Some(s) = room.seats[seat as usize].as_mut() {
                        s.tx = None;
                    }
                    room.broadcast(&[]);
                }
            }
        }
    }
}
