//! Book Shootout rules engine.
//!
//! Shared by the online server (native) and local play in the browser (WASM),
//! so both modes follow exactly the same rules.
//!
//! A turn is always "open the book". The last digit of the (odd) page picks one of
//! your soldiers:
//! - not finished yet: it gets its next drawing (head, body, face, gun)
//! - has a gun but no bullet: the bullet is loaded
//! - has a bullet: it fires. The same player must then pick an enemy soldier to
//!   shoot (`Action::Shoot`) before the turn passes.
//! - already out: the turn is lost
//!
//! Soldiers only fire when the page lands on their number.

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
    pub alive: bool,
}

impl Default for Soldier {
    fn default() -> Self {
        Soldier { stage: 0, loaded: false, alive: true }
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
    /// Increments after every completed turn.
    pub turn: u32,
    pub winner: Option<u8>,
    /// Who started this game; rematches alternate.
    pub starter: u8,
    /// Set when the current player's page landed on a loaded soldier: that soldier
    /// (slot index) is aiming and the player must pick a target.
    #[serde(default)]
    pub aiming: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Action {
    /// Open the book. `page` is the odd right-hand page, supplied by whoever owns
    /// randomness (server or browser).
    Flip { page: u32 },
    /// Fire the aiming soldier (`from`, slot index) at an enemy soldier (`target`, slot index).
    /// Only allowed right after a flip landed on a loaded soldier.
    Shoot { from: u8, target: u8 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum FlipOutcome {
    /// The slot was already eliminated.
    Dead { slot: u8 },
    /// A new body part was drawn.
    Drew { slot: u8, part: Part },
    /// A bullet was loaded.
    Loaded { slot: u8 },
    /// The soldier had a bullet: it's aiming, and the player picks a target next.
    Aim { slot: u8 },
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
    MustShoot,
    NotAiming,
    NoTarget,
}

impl std::fmt::Display for RuleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let msg = match self {
            RuleError::GameOver => "The game is already over.",
            RuleError::BadPage => "Only odd page numbers count.",
            RuleError::BadSlot => "That slot does not exist.",
            RuleError::MustShoot => "Your soldier is aiming. Pick an enemy soldier to shoot first.",
            RuleError::NotAiming => "A soldier can only shoot when the page lands on its number.",
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
            aiming: None,
        }
    }

    /// A fresh game where the other player starts.
    pub fn rematch(&self) -> Game {
        Game::new(self.starter ^ 1)
    }

    fn end_turn(&mut self) {
        self.turn += 1;
        if self.winner.is_none() {
            self.current ^= 1;
        }
    }

    pub fn apply(&mut self, action: &Action) -> Result<Vec<Event>, RuleError> {
        if self.winner.is_some() {
            return Err(RuleError::GameOver);
        }
        let me = self.current;
        let mut events = Vec::new();
        match *action {
            Action::Flip { page } => {
                if self.aiming.is_some() {
                    return Err(RuleError::MustShoot);
                }
                // Only the right-hand page counts, and right-hand pages are always odd.
                if page == 0 || page > MAX_PAGE || page % 2 == 0 {
                    return Err(RuleError::BadPage);
                }
                let digit = (page % 10) as u8;
                let slot = (digit - 1) / 2;
                let s = &mut self.players[me as usize].soldiers[slot as usize];
                let outcome = if !s.alive {
                    FlipOutcome::Dead { slot }
                } else if s.stage < MAX_STAGE {
                    s.stage += 1;
                    FlipOutcome::Drew { slot, part: Part::from_stage(s.stage) }
                } else if !s.loaded {
                    s.loaded = true;
                    FlipOutcome::Loaded { slot }
                } else {
                    FlipOutcome::Aim { slot }
                };
                let aim = matches!(outcome, FlipOutcome::Aim { .. });
                events.push(Event::Flip { player: me, page, digit, outcome });
                if aim {
                    // Same player picks a target; the turn ends after the shot.
                    self.aiming = Some(slot);
                } else {
                    self.end_turn();
                }
            }
            Action::Shoot { from, target } => {
                if from > 4 || target > 4 {
                    return Err(RuleError::BadSlot);
                }
                if self.aiming != Some(from) {
                    return Err(RuleError::NotAiming);
                }
                let foe = (me ^ 1) as usize;
                if !self.players[foe].soldiers[target as usize].alive {
                    return Err(RuleError::NoTarget);
                }
                self.players[foe].soldiers[target as usize].alive = false;
                self.players[me as usize].soldiers[from as usize].loaded = false;
                self.aiming = None;
                events.push(Event::Shot { player: me, from, target });
                if self.players[foe].alive_count() == 0 {
                    self.winner = Some(me);
                    events.push(Event::Win { player: me });
                }
                self.end_turn();
            }
        }
        Ok(events)
    }

    /// How much opening at `page` would help the current player.
    fn page_value(&self, page: u32) -> u8 {
        let slot = ((page % 10) as usize).saturating_sub(1) / 2;
        let s = &self.players[self.current as usize].soldiers[slot];
        match (s.alive, s.stage, s.loaded) {
            (false, _, _) => 0,
            (true, 4, true) => 40,          // fires
            (true, 4, false) => 30,         // loads a bullet
            (true, stage, _) => 10 + stage, // closer to a gun is better
        }
    }

    /// Computer opponent. All randomness comes from the caller:
    /// `pages` are two random odd pages and `roll` is a random number.
    ///
    /// When its page lands on a loaded soldier it must pick a target:
    /// - Easy: shoots a random soldier.
    /// - Medium: shoots your most-drawn soldier.
    /// - Hard: shoots your biggest threat (loaded > armed > most drawn), and about
    ///   half the time peeks at two pages and opens the better one.
    pub fn bot_action(&self, level: Level, pages: [u32; 2], roll: u32) -> Action {
        let me = self.current as usize;
        let foe = me ^ 1;

        if let Some(from) = self.aiming {
            let alive: Vec<usize> = (0..5).filter(|&i| self.players[foe].soldiers[i].alive).collect();
            let target = match level {
                Level::Easy => alive[(roll as usize) % alive.len()],
                Level::Medium => {
                    *alive.iter().max_by_key(|&&i| self.players[foe].soldiers[i].stage).unwrap()
                }
                Level::Hard => *alive
                    .iter()
                    .max_by_key(|&&i| {
                        let s = &self.players[foe].soldiers[i];
                        (s.loaded as u8) * 100 + (s.stage == MAX_STAGE) as u8 * 50 + s.stage
                    })
                    .unwrap(),
            };
            return Action::Shoot { from, target: target as u8 };
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
    fn outcome(ev: &[Event]) -> &FlipOutcome {
        match &ev[0] {
            Event::Flip { outcome, .. } => outcome,
            _ => panic!("not a flip"),
        }
    }

    /// Player 1's pages: one head on each of its soldiers in turn, so it never aims.
    const P1: [u32; 5] = [11, 13, 15, 17, 19];

    /// Player 0 builds and loads the soldier at page `p0`; player 1 only draws heads.
    fn armed(p0: u32) -> Game {
        let mut g = Game::new(0);
        for p in P1 {
            flip(&mut g, p0);
            flip(&mut g, p);
        }
        g
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
    fn build_then_load() {
        let g = armed(13);
        let s = &g.players[0].soldiers[1];
        assert_eq!(s.stage, 4);
        assert!(s.loaded);
        assert_eq!(g.current, 0);
        assert_eq!(g.aiming, None);
    }

    #[test]
    fn landing_on_loaded_soldier_aims_and_same_player_shoots() {
        let mut g = armed(13);
        let ev = flip(&mut g, 23); // soldier 3 has a bullet
        assert!(matches!(outcome(&ev), FlipOutcome::Aim { slot: 1 }));
        assert_eq!(g.aiming, Some(1));
        assert_eq!(g.current, 0, "turn stays with the shooter");
        // Can't open the book again before shooting.
        assert_eq!(g.apply(&Action::Flip { page: 1 }).unwrap_err(), RuleError::MustShoot);
        // Shoot enemy soldier 1 (index 0), even though it only has a head.
        g.apply(&Action::Shoot { from: 1, target: 0 }).unwrap();
        assert!(!g.players[1].soldiers[0].alive);
        assert!(!g.players[0].soldiers[1].loaded, "bullet used");
        assert_eq!(g.aiming, None);
        assert_eq!(g.current, 1, "turn passes after the shot");
        // Next landing on 3 reloads; the one after fires again.
        flip(&mut g, 13);
        assert!(matches!(outcome(&flip(&mut g, 3)), FlipOutcome::Loaded { slot: 1 }));
        flip(&mut g, 15);
        assert!(matches!(outcome(&flip(&mut g, 33)), FlipOutcome::Aim { slot: 1 }));
    }

    #[test]
    fn only_the_soldier_the_page_lands_on_can_shoot() {
        // Player 0 loads soldiers 3 and 5.
        let mut g = armed(13);
        for p in P1 {
            flip(&mut g, 15);
            flip(&mut g, p);
        }
        assert!(g.players[0].soldiers[1].loaded && g.players[0].soldiers[2].loaded);
        // Without the page landing on them, neither may shoot.
        assert_eq!(g.apply(&Action::Shoot { from: 1, target: 0 }).unwrap_err(), RuleError::NotAiming);
        assert_eq!(g.apply(&Action::Shoot { from: 2, target: 0 }).unwrap_err(), RuleError::NotAiming);
        // Page lands on 5: only soldier 5 (index 2) may shoot.
        flip(&mut g, 105);
        assert_eq!(g.aiming, Some(2));
        assert_eq!(g.apply(&Action::Shoot { from: 1, target: 0 }).unwrap_err(), RuleError::NotAiming);
        g.apply(&Action::Shoot { from: 2, target: 0 }).unwrap();
        assert!(g.players[0].soldiers[1].loaded, "soldier 3 keeps its bullet");
    }

    #[test]
    fn dead_slot_is_wasted_and_last_standing_wins() {
        let mut g = armed(1);
        for t in 0..5u8 {
            assert!(matches!(outcome(&flip(&mut g, 1)), FlipOutcome::Aim { slot: 0 }));
            g.apply(&Action::Shoot { from: 0, target: t }).unwrap_or_else(|e| panic!("{e}"));
            if g.winner.is_some() {
                break;
            }
            // Player 1's soldier 1 went out on the first shot: landing on it wastes the turn.
            assert!(matches!(outcome(&flip(&mut g, 11)), FlipOutcome::Dead { slot: 0 }));
            assert!(matches!(outcome(&flip(&mut g, 1)), FlipOutcome::Loaded { slot: 0 }));
            flip(&mut g, 11);
        }
        assert_eq!(g.winner, Some(0));
        assert!(g.apply(&Action::Flip { page: 1 }).is_err());
    }

    #[test]
    fn bot_levels() {
        // Player 1 (the bot) to move, with a loaded soldier 9. Player 0 has an armed
        // soldier 1 and a half-drawn soldier 3.
        let mut g = Game::new(1);
        g.players[1].soldiers[4] = Soldier { stage: 4, loaded: true, alive: true };
        g.players[0].soldiers[0].stage = 4;
        g.players[0].soldiers[1].stage = 2;
        flip(&mut g, 19); // lands on the loaded 9: aims
        assert_eq!(g.aiming, Some(4));
        // Bot must shoot when aiming, at every level.
        for level in [Level::Easy, Level::Medium, Level::Hard] {
            assert!(matches!(g.bot_action(level, [1, 1], 7), Action::Shoot { from: 4, .. }));
        }
        // Medium and hard go for the armed soldier 1 (index 0).
        assert!(matches!(g.bot_action(Level::Medium, [1, 1], 0), Action::Shoot { target: 0, .. }));
        assert!(matches!(g.bot_action(Level::Hard, [1, 1], 0), Action::Shoot { target: 0, .. }));

        // Not aiming: bots open the book. Hard prefers the page that fires its loaded soldier.
        let mut quiet = Game::new(0);
        quiet.players[0].soldiers[0].stage = 4;
        quiet.players[0].soldiers[0].loaded = true;
        assert!(matches!(quiet.bot_action(Level::Hard, [33, 21], 0), Action::Flip { page: 21 }));
        assert!(matches!(quiet.bot_action(Level::Medium, [33, 21], 0), Action::Flip { page: 33 }));
    }
}
