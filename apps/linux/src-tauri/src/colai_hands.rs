//! A pointer and a keyboard of an agent's own.
//!
//! X has let one display carry several independent pointer/keyboard pairs since 2009 —
//! each with its own cursor, its own focus, its own idea of which modifiers are down.
//! Nearly nothing uses it, because nearly nothing needed to. This does: an agent that
//! borrows the one cursor takes the machine away from the person sitting at it, and two
//! agents that borrow it take it away from each other.
//!
//! So every agent gets a pair colai made for it. The person's own pair is never named
//! here — not guarded against, *named*: `Hands` has private fields and one private
//! constructor, so the only device ids that can reach an action are ids this file
//! created. There is no argument anybody could pass to make an agent drive the pointer
//! in somebody's hand.
//!
//! One thread owns the X connection and everything is asked of it by message. Xlib is
//! not thread-safe without being told to be, commands arrive on whichever thread Tauri
//! feels like, and a connection per action would pay a handshake to send one click. A
//! thread with a channel is the small, boring answer to all three.

#![cfg(target_os = "linux")]

use std::sync::mpsc::{channel, Sender};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter as _};

/// What this desktop does with a second pointer, once somebody has actually tried.
///
/// The question is about the compositor, not about X: the protocol has supported extra
/// masters for fifteen years, and whether the desktop draws their cursors and routes
/// their focus is a different question that only measurement answers. Measured once,
/// because the answer cannot change while the session is running.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum Honours {
    /// An agent can have a cursor of its own here.
    Yes,
    /// It cannot, and this is what went wrong. Said in words somebody can act on rather
    /// than as a bare false — "your desktop refused" and "there is no X here at all"
    /// lead to different places.
    No { why: String },
}

/// One thing an agent can do with its own hands.
///
/// This is `computer.act`'s own vocabulary, spelled exactly as it arrives on the wire —
/// action names in snake_case, fields in camelCase, unknown fields ignored. Not a
/// translation of it: a second vocabulary would mean a mapping to keep in step with a
/// contract that lives in another language in another directory, and it would drift.
///
/// Only the actions a pointer and a keyboard can carry out. Screenshots, window lists
/// and the accessibility tree are all real `computer.act` actions and none of them are
/// this file's business.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(
    tag = "action",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub(crate) enum Act {
    MouseMove {
        x: Option<f64>,
        y: Option<f64>,
    },
    LeftClick {
        x: Option<f64>,
        y: Option<f64>,
    },
    RightClick {
        x: Option<f64>,
        y: Option<f64>,
    },
    MiddleClick {
        x: Option<f64>,
        y: Option<f64>,
    },
    DoubleClick {
        x: Option<f64>,
        y: Option<f64>,
    },
    TripleClick {
        x: Option<f64>,
        y: Option<f64>,
    },
    Scroll {
        x: Option<f64>,
        y: Option<f64>,
        scroll_direction: Option<String>,
        scroll_amount: Option<u32>,
    },
    Type {
        text: Option<String>,
    },
    Key {
        keys: Option<String>,
    },
}

/// Where an action happens, when it says.
///
/// Optional because the contract makes it optional: an action with no coordinates
/// happens wherever this agent's cursor already is, which is what makes a drag or a
/// second click on the same spot expressible.
type Spot = Option<(f64, f64)>;

/// What one of those actually amounts to, once the vocabulary is resolved.
///
/// Split out so the whole mapping — every action name, every button number, every scroll
/// direction — is a pure function with tests on it, provable without a display, a
/// desktop, or a second cursor to test against.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Doing {
    /// Move the cursor and nothing else.
    Point(Spot),
    /// A button, that many times.
    Press {
        at: Spot,
        button: u32,
        times: u32,
    },
    /// A wheel, that many notches. X has no scroll axis, so these are buttons too.
    Wheel {
        at: Spot,
        button: u32,
        notches: u32,
    },
    Write(String),
    Chord(String),
    /// Nothing to do, and that is not a failure — `type` with no text is a no-op, not an
    /// error, and treating it as one would fail a run over an empty string.
    Nothing,
}

/// X's button numbers. Wheels are buttons here, which is not a workaround but how the
/// protocol has always carried scrolling.
const WHEEL_UP: u32 = 4;
const WHEEL_DOWN: u32 = 5;
const WHEEL_LEFT: u32 = 6;
const WHEEL_RIGHT: u32 = 7;

/// What an action means, or why it cannot be carried out.
///
/// Refusing beats guessing. A scroll direction nobody recognises could be defaulted to
/// "down" and would then scroll the wrong way for ever without anybody knowing why.
pub(crate) fn meaning(act: &Act) -> Result<Doing, String> {
    Ok(match act {
        Act::MouseMove { x, y } => Doing::Point(spot(*x, *y)),
        Act::LeftClick { x, y } => Doing::Press {
            at: spot(*x, *y),
            button: 1,
            times: 1,
        },
        Act::MiddleClick { x, y } => Doing::Press {
            at: spot(*x, *y),
            button: 2,
            times: 1,
        },
        Act::RightClick { x, y } => Doing::Press {
            at: spot(*x, *y),
            button: 3,
            times: 1,
        },
        Act::DoubleClick { x, y } => Doing::Press {
            at: spot(*x, *y),
            button: 1,
            times: 2,
        },
        Act::TripleClick { x, y } => Doing::Press {
            at: spot(*x, *y),
            button: 1,
            times: 3,
        },
        Act::Scroll {
            x,
            y,
            scroll_direction,
            scroll_amount,
        } => {
            let which = scroll_direction.as_deref().unwrap_or("down");
            let button = match which {
                "up" => WHEEL_UP,
                "down" => WHEEL_DOWN,
                "left" => WHEEL_LEFT,
                "right" => WHEEL_RIGHT,
                other => return Err(format!("there is no way to scroll {other:?}")),
            };
            Doing::Wheel {
                at: spot(*x, *y),
                button,
                notches: scroll_amount.unwrap_or(1),
            }
        }
        Act::Type { text } => match text.as_deref().unwrap_or("") {
            "" => Doing::Nothing,
            words => Doing::Write(words.to_string()),
        },
        Act::Key { keys } => match keys.as_deref().unwrap_or("").trim() {
            "" => return Err("that key press names no keys".into()),
            combo => Doing::Chord(combo.to_string()),
        },
    })
}

/// Both or neither. Half a coordinate is not a place, and silently treating a missing
/// `y` as zero would put the cursor at the top of the screen rather than where it is.
fn spot(x: Option<f64>, y: Option<f64>) -> Spot {
    match (x, y) {
        (Some(x), Some(y)) => Some((x, y)),
        _ => None,
    }
}

/// Where one agent's cursor is, for drawing it.
///
/// GNOME does not render extra master pointers — the protocol moves them, the
/// compositor ignores them — so an agent working is invisible unless colai draws it. It
/// already holds a transparent sheet over the whole desktop, and X will say where any
/// pointer is, so the two halves were already here.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Hand {
    pub agent: String,
    pub x: f64,
    pub y: f64,
}

/// The event the page listens for.
pub(crate) const HANDS_EVENT: &str = "colai:hands";

/// How often cursors are looked at while one is moving.
///
/// A drawn cursor that updates on its own slower clock trails the real one, and a
/// pointer lagging behind itself reads as broken rather than as attached. Nothing is
/// polled at all unless some agent actually has hands, so the idle cost is zero.
const WHILE_MOVING: Duration = Duration::from_millis(16);

/// And while every agent is holding still, which is most of the time even mid-task.
const WHEN_STILL: Duration = Duration::from_millis(100);

/// How long after the last movement to keep looking quickly.
const STAYS_LIVELY: Duration = Duration::from_millis(400);

/// What the thread that owns the display is asked to do.
enum Order {
    /// Somewhere to send cursor positions. Sent once, when the app is up.
    Watch(AppHandle),
    Honours(Sender<Honours>),
    Act(String, u64, Doing, Sender<Result<(), String>>),
    Unmake(String),
    UnmakeAll(Sender<()>),
}

static ORDERS: OnceLock<Option<Sender<Order>>> = OnceLock::new();

/// Reach the one thread that may touch X, starting it the first time anybody asks.
fn orders() -> Option<&'static Sender<Order>> {
    ORDERS
        .get_or_init(|| {
            let (say, hear) = channel::<Order>();
            std::thread::Builder::new()
                .name("colai-hands".into())
                .spawn(move || hands_thread(&hear))
                .ok()
                .map(|_| say)
        })
        .as_ref()
}

/// The only thread that touches X. The display is opened here and never leaves.
fn hands_thread(hear: &std::sync::mpsc::Receiver<Order>) {
    let Some(mut crew) = x11::Crew::open() else {
        // Answer everything honestly rather than hanging: a caller that never hears back
        // is a worse failure than one told there is no display.
        let nothing = || "there is no X display to open".to_string();
        while let Ok(order) = hear.recv() {
            match order {
                Order::Honours(back) => {
                    let _ = back.send(Honours::No { why: nothing() });
                }
                Order::Act(_, _, _, back) => {
                    let _ = back.send(Err(nothing()));
                }
                Order::UnmakeAll(back) => {
                    let _ = back.send(());
                }
                Order::Unmake(_) | Order::Watch(_) => {}
            }
        }
        return;
    };
    // Where to send cursor positions, and when they last moved. Both stay unset until
    // there is an app to tell and an agent to watch, which is what keeps an idle colai
    // from polling X at all.
    let mut watching: Option<AppHandle> = None;
    let mut said: Vec<Hand> = Vec::new();
    let mut moved = Instant::now();
    loop {
        // Blocking while nothing has hands. A desktop with no agent working costs one
        // parked thread and no round trips at all.
        let order = if watching.is_some() && crew.busy() {
            let waiting = if moved.elapsed() < STAYS_LIVELY {
                WHILE_MOVING
            } else {
                WHEN_STILL
            };
            match hear.recv_timeout(waiting) {
                Ok(order) => Some(order),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => None,
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
        } else {
            match hear.recv() {
                Ok(order) => Some(order),
                Err(_) => break,
            }
        };

        match order {
            None => {
                // Nothing asked; this is the look. Sent only when it differs, because a
                // cursor that has not moved is not news and the page redraws on every one.
                let now = crew.cursors();
                if now != said {
                    moved = Instant::now();
                    said = now.clone();
                    if let Some(app) = &watching {
                        let _ = app.emit_to(crate::colai::OVERLAY_LABEL, HANDS_EVENT, now);
                    }
                }
            }
            Some(Order::Watch(app)) => watching = Some(app),
            Some(Order::Honours(back)) => {
                let _ = back.send(crew.honours());
            }
            Some(Order::Act(agent, window, act, back)) => {
                let _ = back.send(crew.act(&agent, window, &act));
                // Acting is the one moment a cursor certainly moved, so look promptly
                // rather than waiting out the still-pace.
                moved = Instant::now();
            }
            Some(Order::Unmake(agent)) => {
                crew.unmake(&agent);
                said.clear();
                if let Some(app) = &watching {
                    let _ = app.emit_to(crate::colai::OVERLAY_LABEL, HANDS_EVENT, &said);
                }
            }
            Some(Order::UnmakeAll(back)) => {
                crew.unmake_all();
                said.clear();
                if let Some(app) = &watching {
                    let _ = app.emit_to(crate::colai::OVERLAY_LABEL, HANDS_EVENT, &said);
                }
                let _ = back.send(());
            }
        }
    }
    // The channel is closed, so colai is going away. Every pair colai made goes with it:
    // a master left behind outlives the process, and shows up as a cursor on somebody's
    // desktop that nothing accounts for.
    crew.unmake_all();
}

/// Ask the thread something and wait for the answer.
fn ask<T>(make: impl FnOnce(Sender<T>) -> Order, gone: T) -> T {
    let Some(orders) = orders() else {
        return gone;
    };
    let (say, hear) = channel::<T>();
    if orders.send(make(say)).is_err() {
        return gone;
    }
    hear.recv().unwrap_or(gone)
}

/// What every caller is told when the thread that owns the display never answers.
///
/// One sentence in one place: every entry point below can hit it, and three spellings of
/// the same failure would read as three different failures.
const SILENT: &str = "the display thread did not answer";

/// Whether an agent can have a cursor of its own on this desktop.
///
/// Asked once and remembered. This is the fact the whole feature stands on, and it is
/// measured rather than assumed — see `Crew::honours`.
pub(crate) fn honours() -> Honours {
    static ASKED: OnceLock<Honours> = OnceLock::new();
    ASKED
        .get_or_init(|| ask(Order::Honours, Honours::No { why: SILENT.into() }))
        .clone()
}

/// Do one thing, as one agent, in one window.
///
/// The vocabulary is resolved here, before the message is sent: an action nobody
/// recognises is refused at the edge where the caller is still waiting, rather than on
/// the thread that owns the display where it would be one more thing that can go wrong
/// far away from whoever asked.
pub(crate) fn act(agent: &str, window: u64, what: &Act) -> Result<(), String> {
    let doing = meaning(what)?;
    let agent = agent.to_string();
    ask(
        move |back| Order::Act(agent, window, doing, back),
        Err(SILENT.into()),
    )
}

/// Open the private socket a node worker asks through.
///
/// Separate from `watch` because they answer to different owners: one is colai telling
/// its own page what to draw, the other is the only way anything outside this process
/// can move a cursor at all.
pub(crate) fn open_the_door() {
    door::open();
}

/// Tell the display thread where to send cursor positions.
pub(crate) fn watch(app: AppHandle) {
    if let Some(orders) = orders() {
        let _ = orders.send(Order::Watch(app));
    }
}

pub(crate) fn unmake(agent: &str) {
    if let Some(orders) = orders() {
        let _ = orders.send(Order::Unmake(agent.to_string()));
    }
}

/// Take every pair back, and wait until they are gone.
///
/// Waited on deliberately: this runs as colai exits, and a process that exits while the
/// request is still sitting in the channel leaves the masters behind for good.
pub(crate) fn unmake_all() {
    // The door first: a caller that connects between the pairs going away and the
    // process ending would be asking for hands that no longer exist.
    door::close();
    ask(Order::UnmakeAll, ());
}

#[cfg(test)]
mod meaning_tests {
    use super::*;

    fn from(json: &str) -> Act {
        serde_json::from_str(json).expect("computer.act sends this")
    }

    #[test]
    fn every_click_maps_to_the_button_and_the_count_it_names() {
        let at = r#""x": 10, "y": 20"#;
        for (action, button, times) in [
            ("left_click", 1, 1),
            ("middle_click", 2, 1),
            ("right_click", 3, 1),
            ("double_click", 1, 2),
            ("triple_click", 1, 3),
        ] {
            let act = from(&format!(r#"{{"action": "{action}", {at}}}"#));
            assert_eq!(
                meaning(&act).unwrap(),
                Doing::Press {
                    at: Some((10.0, 20.0)),
                    button,
                    times,
                },
                "{action}"
            );
        }
    }

    #[test]
    fn a_scroll_direction_becomes_the_wheel_button_x_uses_for_it() {
        for (way, button) in [("up", 4), ("down", 5), ("left", 6), ("right", 7)] {
            let act = from(&format!(
                r#"{{"action": "scroll", "x": 1, "y": 2, "scrollDirection": "{way}", "scrollAmount": 3}}"#
            ));
            assert_eq!(
                meaning(&act).unwrap(),
                Doing::Wheel {
                    at: Some((1.0, 2.0)),
                    button,
                    notches: 3,
                },
                "{way}"
            );
        }
        // A direction nobody recognises is refused rather than defaulted. Defaulting it
        // would scroll the wrong way for ever without anybody finding out why.
        let sideways = from(r#"{"action": "scroll", "scrollDirection": "widdershins"}"#);
        assert!(meaning(&sideways).is_err());
        // Said nothing: down, one notch, which is what every scroll wheel does.
        let plain = from(r#"{"action": "scroll", "x": 0, "y": 0}"#);
        assert_eq!(
            meaning(&plain).unwrap(),
            Doing::Wheel {
                at: Some((0.0, 0.0)),
                button: 5,
                notches: 1,
            }
        );
    }

    #[test]
    fn half_a_coordinate_is_not_a_place() {
        // The contract makes both optional, and an action with neither happens wherever
        // the cursor already is — that is how a second click on the same spot is said.
        assert_eq!(
            meaning(&from(r#"{"action": "mouse_move"}"#)).unwrap(),
            Doing::Point(None)
        );
        // But half of one is not half a place. Treating a missing y as zero would put
        // the cursor at the top of the screen rather than leaving it where it is.
        assert_eq!(
            meaning(&from(r#"{"action": "mouse_move", "x": 40}"#)).unwrap(),
            Doing::Point(None)
        );
        assert_eq!(
            meaning(&from(r#"{"action": "mouse_move", "x": 40, "y": 50}"#)).unwrap(),
            Doing::Point(Some((40.0, 50.0)))
        );
    }

    #[test]
    fn typing_nothing_is_not_a_failure_but_pressing_nothing_is() {
        // An empty string is a no-op. Failing a whole run because a prompt happened to
        // produce no text would be the tool inventing an error.
        assert_eq!(
            meaning(&from(r#"{"action": "type"}"#)).unwrap(),
            Doing::Nothing
        );
        assert_eq!(
            meaning(&from(r#"{"action": "type", "text": ""}"#)).unwrap(),
            Doing::Nothing
        );
        assert_eq!(
            meaning(&from(r#"{"action": "type", "text": "hello"}"#)).unwrap(),
            Doing::Write("hello".into())
        );
        // A key press naming no keys is different: somebody meant to press something,
        // and silently pressing nothing is the failure that never gets reported.
        assert!(meaning(&from(r#"{"action": "key"}"#)).is_err());
        assert!(meaning(&from(r#"{"action": "key", "keys": "  "}"#)).is_err());
        assert_eq!(
            meaning(&from(r#"{"action": "key", "keys": "ctrl+s"}"#)).unwrap(),
            Doing::Chord("ctrl+s".into())
        );
    }

    #[test]
    fn the_fields_computer_act_also_sends_are_ignored_rather_than_refused() {
        // Real payloads carry executionId, windowRef, displayFrameId and more. Every one
        // of them is somebody else's business, and rejecting the message over them would
        // make this fulfil nothing at all.
        let real = from(
            r#"{"action": "left_click", "x": 5, "y": 6, "executionId": "abc",
                 "windowRef": "0x1", "displayFrameId": "d1", "modifiers": "ctrl"}"#,
        );
        assert_eq!(
            meaning(&real).unwrap(),
            Doing::Press {
                at: Some((5.0, 6.0)),
                button: 1,
                times: 1,
            }
        );
    }

    #[test]
    fn an_action_this_cannot_carry_out_is_not_silently_accepted() {
        // Screenshots, window lists and the accessibility tree are real computer.act
        // actions and none of them are a pointer's business. Failing to parse is the
        // right answer: something else fulfils those.
        for action in [
            "screenshot",
            "list_windows",
            "get_accessibility_tree",
            "wait",
        ] {
            let json = format!(r#"{{"action": "{action}"}}"#);
            assert!(
                serde_json::from_str::<Act>(&json).is_err(),
                "{action} should not parse as something hands can do"
            );
        }
    }
}

mod door;
mod x11;
