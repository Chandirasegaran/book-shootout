//! Book Shootout rules engine.
//!
//! Shared by the online server (native) and local play in the browser (WASM),
//! so both modes follow exactly the same rules.

use serde::{Deserialize, Serialize};

/// Slot numbers, in order. Internally slots are addressed by index 0..5.
pub const SLOT_NUMBERS: [u8; 5] = [1, 3, 5, 7, 9];
/// Head, body, face, gun.
pub const MAX_STAGE: u8 = 4;
pub const MAX_PAGE: u32 = 999;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Part {
    Head,
    Body,
    Face,
    Gun,
}

impl Part {
    fn from_stage(stage: u8) -> Part {
        match stage {
            1 => Part::Head,
            2 => Part::Body,
            3 => Part::Face,
            _ => Part::Gun,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Soldier {
    /// 0 = nothing drawn, 1 head, 2 body, 3 face, 4 gun.
    pub stage: u8,
    pub loaded: bool,
    /// Turn number the bullet was loaded on. A soldier can only fire on a later turn.
    pub loaded_turn: u32,
    pub alive: bool,
}

impl Default for Soldier {
    fn default() -> Self {
        Soldier { stage: 0, loaded: false, loaded_turn: 0, alive: true }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Player {
    pub soldiers: [Soldier; 5],
}

impl Player {
    pub fn alive_count(&self) -> usize {
        self.soldiers.iter().filter(|s| s.alive).count()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Game {
    pub players: [Player; 2],
    /// Whose turn it is (0 or 1).
    pub current: u8,
    /// Increments after every action.
    pub turn: u32,
    pub winner: Option<u8>,
    /// Who started this game; rematches alternate.
    pub starter: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Action {
    /// Open the book. `page` is the odd right-hand page, supplied by whoever owns
    /// randomness (server or browser).
    Flip { page: u32 },
    /// Fire a loaded soldier (`from`, slot index) at an enemy soldier (`target`, slot index).
    Shoot { from: u8, target: u8 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum FlipOutcome {
    /// The slot was already eliminated.
    Dead { slot: u8 },
    /// The soldier already holds its one bullet.
    Full { slot: u8 },
    /// A new body part was drawn.
    Drew { slot: u8, part: Part },
    /// A bullet was loaded.
    Loaded { slot: u8 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Event {
    Flip { player: u8, page: u32, digit: u8, outcome: FlipOutcome },
    Shot { player: u8, from: u8, target: u8 },
    Win { player: u8 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuleError {
    GameOver,
    BadPage,
    BadSlot,
    NotReady,
    NoTarget,
}

impl std::fmt::Display for RuleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let msg = match self {
            RuleError::GameOver => "The game is already over.",
            RuleError::BadPage => "Only odd page numbers count.",
            RuleError::BadSlot => "That slot does not exist.",
            RuleError::NotReady => "That soldier can't fire yet. It needs a loaded bullet from an earlier turn.",
            RuleError::NoTarget => "That enemy soldier is already out.",
        };
        f.write_str(msg)
    }
}

impl Game {
    pub fn new(starter: u8) -> Game {
        Game {
            players: Default::default(),
            current: starter & 1,
            turn: 1,
            winner: None,
            starter: starter & 1,
        }
    }

    /// A fresh game where the other player starts.
    pub fn rematch(&self) -> Game {
        Game::new(self.starter ^ 1)
    }

    pub fn can_fire(&self, player: u8, slot: usize) -> bool {
        let s = &self.players[player as usize].soldiers[slot];
        s.alive && s.stage == MAX_STAGE && s.loaded && s.loaded_turn < self.turn
    }

    pub fn apply(&mut self, action: &Action) -> Result<Vec<Event>, RuleError> {
        if self.winner.is_some() {
            return Err(RuleError::GameOver);
        }
        let me = self.current;
        let mut events = Vec::new();
        match *action {
            Action::Flip { page } => {
                // Only the right-hand page counts, and right-hand pages are always odd.
                if page == 0 || page > MAX_PAGE || page % 2 == 0 {
                    return Err(RuleError::BadPage);
                }
                let digit = (page % 10) as u8;
                let outcome = {
                    let slot = (digit - 1) / 2;
                    let turn = self.turn;
                    let s = &mut self.players[me as usize].soldiers[slot as usize];
                    if !s.alive {
                        FlipOutcome::Dead { slot }
                    } else if s.stage < MAX_STAGE {
                        s.stage += 1;
                        FlipOutcome::Drew { slot, part: Part::from_stage(s.stage) }
                    } else if s.loaded {
                        FlipOutcome::Full { slot }
                    } else {
                        s.loaded = true;
                        s.loaded_turn = turn;
                        FlipOutcome::Loaded { slot }
                    }
                };
                events.push(Event::Flip { player: me, page, digit, outcome });
            }
            Action::Shoot { from, target } => {
                if from > 4 || target > 4 {
                    return Err(RuleError::BadSlot);
                }
                if !self.can_fire(me, from as usize) {
                    return Err(RuleError::NotReady);
                }
                let foe = (me ^ 1) as usize;
                if !self.players[foe].soldiers[target as usize].alive {
                    return Err(RuleError::NoTarget);
                }
                self.players[foe].soldiers[target as usize].alive = false;
                self.players[me as usize].soldiers[from as usize].loaded = false;
                events.push(Event::Shot { player: me, from, target });
                if self.players[foe].alive_count() == 0 {
                    self.winner = Some(me);
                    events.push(Event::Win { player: me });
                }
            }
        }
        self.turn += 1;
        if self.winner.is_none() {
            self.current ^= 1;
        }
        Ok(events)
    }

    /// How much opening at `page` would help the current player.
    fn page_value(&self, page: u32) -> u8 {
        let slot = ((page % 10) as usize).saturating_sub(1) / 2;
        let s = &self.players[self.current as usize].soldiers[slot];
        match (s.alive, s.stage, s.loaded) {
            (false, _, _) => 0,
            (true, 4, true) => 1,         // already loaded: wasted
            (true, 4, false) => 30,       // loads a bullet
            (true, stage, _) => 10 + stage, // closer to a gun is better
        }
    }

    /// Computer opponent. All randomness comes from the caller:
    /// `pages` are two random odd pages and `roll` is a random number.
    ///
    /// - Easy: sometimes forgets to shoot, and shoots at a random soldier.
    /// - Medium: always shoots when it can, at the most-drawn soldier.
    /// - Hard: shoots the biggest threat first, and gets a little lucky:
    ///   about half the time it peeks at two pages and opens the better one.
    pub fn bot_action(&self, level: Level, pages: [u32; 2], roll: u32) -> Action {
        let me = self.current as usize;
        let foe = me ^ 1;
        let alive: Vec<usize> = (0..5).filter(|&i| self.players[foe].soldiers[i].alive).collect();
        let shooter = (0..5).find(|&i| self.can_fire(me as u8, i));

        if let (Some(from), false) = (shooter, alive.is_empty()) {
            let target = match level {
                Level::Easy => (roll % 2 == 0).then(|| alive[(roll as usize / 2) % alive.len()]),
                Level::Medium => alive.iter().copied().max_by_key(|&i| self.players[foe].soldiers[i].stage),
                Level::Hard => alive.iter().copied().max_by_key(|&i| {
                    let s = &self.players[foe].soldiers[i];
                    // loaded > armed > most drawn
                    (s.loaded as u8) * 100 + (s.stage == MAX_STAGE) as u8 * 50 + s.stage
                }),
            };
            if let Some(target) = target {
                return Action::Shoot { from: from as u8, target: target as u8 };
            }
        }

        // Hard peeks at a second page on about half its turns. Peeking every turn wins
        // over 90% of games against Medium, which is no fun to play against.
        let peeks = (roll >> 1) % 2 == 0;
        let page = match level {
            Level::Hard if peeks && self.page_value(pages[1]) > self.page_value(pages[0]) => pages[1],
            _ => pages[0],
        };
        Action::Flip { page }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Easy,
    #[default]
    Medium,
    Hard,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flip(g: &mut Game, page: u32) -> Vec<Event> {
        g.apply(&Action::Flip { page }).unwrap()
    }

    #[test]
    fn even_page_is_rejected() {
        let mut g = Game::new(0);
        assert_eq!(g.apply(&Action::Flip { page: 12 }).unwrap_err(), RuleError::BadPage);
        assert_eq!(g.current, 0);
        flip(&mut g, 13);
        assert_eq!(g.current, 1);
        assert_eq!(g.players[0].soldiers[1].stage, 1);
    }

    #[test]
    fn build_load_wait_then_shoot() {
        let mut g = Game::new(0);
        // Player 0 builds slot "3" (index 1); player 1 builds slot "9".
        for _ in 0..4 {
            flip(&mut g, 13);
            flip(&mut g, 19);
        }
        assert_eq!(g.players[0].soldiers[1].stage, 4);
        flip(&mut g, 23); // load
        assert!(g.players[0].soldiers[1].loaded);
        flip(&mut g, 19);
        // Extra hit while loaded does nothing.
        let ev = g.clone().apply(&Action::Flip { page: 3 }).unwrap();
        assert!(matches!(ev[0], Event::Flip { outcome: FlipOutcome::Full { .. }, .. }));
        // Shoot enemy slot 1 (index 0), even though it has nothing drawn.
        g.apply(&Action::Shoot { from: 1, target: 0 }).unwrap();
        assert!(!g.players[1].soldiers[0].alive);
        assert!(!g.players[0].soldiers[1].loaded);
    }

    #[test]
    fn cannot_fire_on_turn_after_loading_by_opponent_only() {
        let mut g = Game::new(0);
        for _ in 0..4 {
            flip(&mut g, 1);
            flip(&mut g, 19);
        }
        flip(&mut g, 1); // loaded on this turn
        // Opponent's turn: player 0 cannot act anyway; on player 0's next turn they can fire.
        flip(&mut g, 19);
        assert!(g.can_fire(0, 0));
    }

    #[test]
    fn dead_slot_is_wasted_and_last_standing_wins() {
        let mut g = Game::new(0);
        for _ in 0..5 {
            flip(&mut g, 1);
            flip(&mut g, 11);
        }
        for t in 0..5u8 {
            g.apply(&Action::Shoot { from: 0, target: t }).unwrap_or_else(|e| panic!("{e}"));
            if t == 4 {
                break;
            }
            flip(&mut g, 11); // opponent: soldier 1 is out, so this is wasted
            flip(&mut g, 1); // reload
            let ev = flip(&mut g, 11);
            assert!(matches!(ev[0], Event::Flip { outcome: FlipOutcome::Dead { slot: 0 }, .. }));
        }
        assert_eq!(g.winner, Some(0));
        assert!(g.apply(&Action::Flip { page: 1 }).is_err());
    }

    #[test]
    fn bot_levels() {
        let mut g = Game::new(0);
        // Player 0 gets a ready shooter in slot 1; player 1 has an armed soldier in slot 9.
        for _ in 0..4 {
            flip(&mut g, 1);
            flip(&mut g, 19);
        }
        flip(&mut g, 1); // load
        flip(&mut g, 13); // enemy draws a head on slot 3
        assert!(g.can_fire(0, 0));

        // Medium and hard shoot the armed soldier 9 (index 4).
        for level in [Level::Medium, Level::Hard] {
            assert!(matches!(g.bot_action(level, [1, 1], 0), Action::Shoot { from: 0, target: 4 }));
        }
        // Easy with an odd roll forgets to shoot.
        assert!(matches!(g.bot_action(Level::Easy, [3, 3], 1), Action::Flip { page: 3 }));

        // Hard picks the more useful of two pages: soldier 1 was just loaded (can't fire yet),
        // so page 21 would be wasted and page 33 draws on soldier 3.
        let mut quiet = Game::new(0);
        quiet.players[0].soldiers[0].stage = 4;
        quiet.players[0].soldiers[0].loaded = true;
        quiet.players[0].soldiers[0].loaded_turn = quiet.turn;
        assert!(matches!(quiet.bot_action(Level::Hard, [21, 33], 0), Action::Flip { page: 33 }));
        assert!(matches!(quiet.bot_action(Level::Medium, [21, 33], 0), Action::Flip { page: 21 }));
    }
}
