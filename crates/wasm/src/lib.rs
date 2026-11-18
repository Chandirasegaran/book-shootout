//! Tiny JSON-in / JSON-out bridge so the browser can run the same Rust rules
//! for local play. No wasm-bindgen needed: JS writes a request into memory
//! from `alloc`, calls `call`, then reads `out_len` bytes from `out_ptr`.

use game_core::{Action, Game, Level};
use serde::Deserialize;
use serde_json::json;
use std::cell::RefCell;

thread_local! {
    static OUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
enum Request {
    New { starter: u8 },
    Apply { state: Game, action: Action },
    Bot {
        state: Game,
        #[serde(default)]
        level: Level,
        pages: [u32; 2],
        roll: u32,
    },
}

fn handle(input: &[u8]) -> serde_json::Value {
    let req: Request = match serde_json::from_slice(input) {
        Ok(r) => r,
        Err(e) => return json!({ "error": format!("bad request: {e}") }),
    };
    match req {
        Request::New { starter } => json!({ "state": Game::new(starter) }),
        Request::Apply { mut state, action } => match state.apply(&action) {
            Ok(events) => json!({ "state": state, "events": events }),
            Err(e) => json!({ "error": e.to_string() }),
        },
        Request::Bot { state, level, pages, roll } => {
            json!({ "action": state.bot_action(level, pages, roll) })
        }
    }
}

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len);
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// # Safety
/// `ptr` must come from `alloc(len)`.
#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(ptr, 0, len));
}

/// # Safety
/// `ptr..ptr+len` must be a readable buffer written by the caller.
#[no_mangle]
pub unsafe extern "C" fn call(ptr: *const u8, len: usize) -> usize {
    let input = std::slice::from_raw_parts(ptr, len);
    let out = serde_json::to_vec(&handle(input)).unwrap_or_default();
    OUT.with(|o| {
        *o.borrow_mut() = out;
        o.borrow().len()
    })
}

#[no_mangle]
pub extern "C" fn out_ptr() -> *const u8 {
    OUT.with(|o| o.borrow().as_ptr())
}
