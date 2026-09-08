//! Who is allowed to touch what, while several of them are working at once.
//!
//! The desktop has one of everything an agent needs: one pointer, one keyboard focus,
//! one text caret per field. So "two agents working in parallel" is true across windows
//! and a lie inside one — two of them typing into the same box interleave into nonsense
//! however many keyboards X thinks are pointing at it, and neither one can tell.
//!
//! This is where that is said out loud. A surface is claimed before it is worked on and
//! released afterwards, and a claim on a surface somebody already holds is refused with
//! the holder's name rather than granted and regretted. It is a small amount of code
//! standing where the worst failure in the system would otherwise be: two agents that
//! both believe they succeeded, on a window where neither did.
//!
//! Nothing here touches X. Deliberately — the rules are worth having whichever way the
//! question about extra pointers is answered, and rules with no I/O in them are rules
//! that can be tested exhaustively in microseconds.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter as _};

/// How long a claim lives without being renewed.
///
/// Every action an agent takes renews its own claim, so this is not a budget for the
/// work — it is how long a *stopped* agent keeps a window to itself. An agent that is
/// killed, wedged, or disconnected releases nothing, and without an expiry its last
/// window would be unusable by anybody until colai restarted.
///
/// Chosen against the gap between actions rather than the length of a task: a few
/// seconds covers a model thinking between two clicks, and still hands a crashed
/// agent's window back while somebody is still wondering why it stopped.
const CLAIM_LASTS: Duration = Duration::from_secs(20);

/// The event the page listens for. Who is working, and where, has to be visible: an
/// agent typing into a window somebody cannot see is the thing that makes a shared
/// desktop feel haunted rather than shared.
pub(crate) const HOLDING_EVENT: &str = "colai:holding";

/// A place that can only be worked on by one agent at a time.
///
/// A window, by its X id. The unit is the window rather than the screen because that is
/// the boundary the contention is actually at — two agents in two windows genuinely do
/// not collide, and treating the whole desktop as one surface would make "parallel"
/// mean "taking turns".
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
pub(crate) struct Surface(String);

impl Surface {
    pub(crate) fn window(id: impl Into<String>) -> Self {
        Self(id.into())
    }
}

/// One agent's hold on one surface.
#[derive(Debug, Clone)]
struct Held {
    holder: String,
    since: Instant,
    until: Instant,
}

/// What happened when somebody asked for a surface.
///
/// A closed answer rather than a bool, because "no" is only useful with the name
/// attached: the agent that is refused needs to wait for a particular other agent, and
/// the person watching needs to know which one to stop.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum Claimed {
    /// It is yours, until you release it or it expires.
    Taken,
    /// Somebody else has it. Theirs.
    Busy { holder: String },
}

/// What is being worked on right now, as the page needs to draw it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Working {
    pub holder: String,
    pub surface: Surface,
    /// How long they have had it, in milliseconds. A duration rather than a timestamp
    /// because the page has no business knowing when this process started counting.
    pub for_ms: u64,
}

/// Every claim on the desktop.
#[derive(Debug, Default)]
pub(crate) struct Desk {
    held: HashMap<Surface, Held>,
}

impl Desk {
    /// Ask for a surface.
    ///
    /// Asking again for something you already hold renews it rather than failing. An
    /// agent doing ten things to one window would otherwise have to track its own claim
    /// and re-ask on a schedule, and every caller that got that wrong would look like a
    /// contention bug in here.
    pub(crate) fn claim(&mut self, holder: &str, surface: Surface, now: Instant) -> Claimed {
        self.sweep(now);
        match self.held.get_mut(&surface) {
            Some(held) if held.holder != holder => Claimed::Busy {
                holder: held.holder.clone(),
            },
            Some(held) => {
                held.until = now + CLAIM_LASTS;
                Claimed::Taken
            }
            None => {
                self.held.insert(
                    surface,
                    Held {
                        holder: holder.to_string(),
                        since: now,
                        until: now + CLAIM_LASTS,
                    },
                );
                Claimed::Taken
            }
        }
    }

    /// Give one back. Only the holder can; a release from anybody else is ignored
    /// rather than obeyed, so one agent finishing cannot free a window out from under
    /// another that is mid-way through typing into it.
    pub(crate) fn release(&mut self, holder: &str, surface: &Surface) {
        let whose = self.held.get(surface).map(|held| held.holder.as_str());
        if whose == Some(holder) {
            self.held.remove(surface);
        }
    }

    /// Give everything back, because the agent is gone.
    ///
    /// The path that matters most: an agent that stops — finished, aborted, crashed —
    /// holds windows it will never use again, and waiting `CLAIM_LASTS` for each of them
    /// is twenty seconds of a desktop that looks broken. Expiry is the safety net for
    /// the deaths nobody told us about; this is for the ones we know about.
    pub(crate) fn dropped(&mut self, holder: &str) {
        self.held.retain(|_, held| held.holder != holder);
    }

    /// Forget anything nobody renewed.
    fn sweep(&mut self, now: Instant) {
        self.held.retain(|_, held| held.until > now);
    }

    /// Who is working, and for how long, oldest first.
    ///
    /// Ordered so the list does not reshuffle itself under somebody reading it — a
    /// `HashMap` iterates differently every time, and a panel that reorders on every
    /// tick is unreadable however correct its contents.
    pub(crate) fn working(&mut self, now: Instant) -> Vec<Working> {
        self.sweep(now);
        let mut all: Vec<Working> = self
            .held
            .iter()
            .map(|(surface, held)| Working {
                holder: held.holder.clone(),
                surface: surface.clone(),
                for_ms: now.saturating_duration_since(held.since).as_millis() as u64,
            })
            .collect();
        // Longest-held first, then by name — never by however the map happened to hash.
        all.sort_by_key(|one| (std::cmp::Reverse(one.for_ms), one.holder.clone()));
        all
    }
}

/// The one desk, because there is one desktop.
static DESK: Mutex<Option<Desk>> = Mutex::new(None);

fn with_desk<T>(act: impl FnOnce(&mut Desk) -> T) -> T {
    let mut desk = DESK.lock().unwrap_or_else(|held| held.into_inner());
    act(desk.get_or_insert_with(Desk::default))
}

/// Say what changed, every time it changes.
///
/// Pushed rather than polled: the page has no way to know an agent let go of a window,
/// and a panel that only refreshes when somebody happens to open it would show work
/// that finished minutes ago. Sent to the overlay alone — no other window has a use for
/// it, and a broadcast wakes every one of them.
fn say_who(app: &AppHandle) {
    let now = with_desk(|desk| desk.working(Instant::now()));
    let _ = app.emit_to(crate::colai::OVERLAY_LABEL, HOLDING_EVENT, now);
}

#[tauri::command]
pub(crate) fn colai_claim_surface(app: AppHandle, holder: String, window: String) -> Claimed {
    let got = with_desk(|desk| desk.claim(&holder, Surface::window(window), Instant::now()));
    say_who(&app);
    got
}

#[tauri::command]
pub(crate) fn colai_free_surface(app: AppHandle, holder: String, window: String) {
    with_desk(|desk| desk.release(&holder, &Surface::window(window)));
    say_who(&app);
}

#[tauri::command]
pub(crate) fn colai_agent_gone(app: AppHandle, holder: String) {
    with_desk(|desk| desk.dropped(&holder));
    say_who(&app);
}

#[tauri::command]
pub(crate) fn colai_who_is_working() -> Vec<Working> {
    with_desk(|desk| desk.working(Instant::now()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn desk() -> (Desk, Instant) {
        (Desk::default(), Instant::now())
    }

    #[test]
    fn one_surface_one_agent() {
        let (mut desk, now) = desk();
        assert_eq!(
            desk.claim("ana", Surface::window("0x1"), now),
            Claimed::Taken
        );
        assert_eq!(
            desk.claim("ben", Surface::window("0x1"), now),
            Claimed::Busy {
                holder: "ana".into()
            }
        );
    }

    #[test]
    fn different_surfaces_do_not_collide() {
        let (mut desk, now) = desk();
        assert_eq!(
            desk.claim("ana", Surface::window("0x1"), now),
            Claimed::Taken
        );
        assert_eq!(
            desk.claim("ben", Surface::window("0x2"), now),
            Claimed::Taken
        );
        assert_eq!(desk.working(now).len(), 2);
    }

    #[test]
    fn asking_again_renews_rather_than_refusing() {
        let (mut desk, now) = desk();
        desk.claim("ana", Surface::window("0x1"), now);
        let later = now + CLAIM_LASTS - Duration::from_secs(1);
        assert_eq!(
            desk.claim("ana", Surface::window("0x1"), later),
            Claimed::Taken
        );
        // Renewed from the second ask, not the first: still hers past the original expiry.
        let past_first = now + CLAIM_LASTS + Duration::from_secs(1);
        assert_eq!(
            desk.claim("ben", Surface::window("0x1"), past_first),
            Claimed::Busy {
                holder: "ana".into()
            }
        );
    }

    #[test]
    fn a_claim_nobody_renewed_expires() {
        let (mut desk, now) = desk();
        desk.claim("ana", Surface::window("0x1"), now);
        let after = now + CLAIM_LASTS + Duration::from_millis(1);
        assert_eq!(
            desk.claim("ben", Surface::window("0x1"), after),
            Claimed::Taken
        );
    }

    #[test]
    fn only_the_holder_can_release() {
        let (mut desk, now) = desk();
        desk.claim("ana", Surface::window("0x1"), now);
        desk.release("ben", &Surface::window("0x1"));
        assert_eq!(
            desk.claim("ben", Surface::window("0x1"), now),
            Claimed::Busy {
                holder: "ana".into()
            }
        );
        desk.release("ana", &Surface::window("0x1"));
        assert_eq!(
            desk.claim("ben", Surface::window("0x1"), now),
            Claimed::Taken
        );
    }

    #[test]
    fn an_agent_that_stops_lets_go_of_everything() {
        let (mut desk, now) = desk();
        desk.claim("ana", Surface::window("0x1"), now);
        desk.claim("ana", Surface::window("0x2"), now);
        desk.claim("ben", Surface::window("0x3"), now);
        desk.dropped("ana");
        assert_eq!(
            desk.claim("ben", Surface::window("0x1"), now),
            Claimed::Taken
        );
        assert_eq!(
            desk.claim("cass", Surface::window("0x2"), now),
            Claimed::Taken
        );
        // And not anybody else's.
        assert_eq!(
            desk.claim("cass", Surface::window("0x3"), now),
            Claimed::Busy {
                holder: "ben".into()
            }
        );
    }

    #[test]
    fn what_is_being_worked_on_reads_the_same_way_twice() {
        let (mut desk, now) = desk();
        desk.claim("ana", Surface::window("0x1"), now);
        desk.claim("ben", Surface::window("0x2"), now + Duration::from_secs(1));
        desk.claim("cass", Surface::window("0x3"), now + Duration::from_secs(2));
        let at = now + Duration::from_secs(3);
        let once = desk.working(at);
        assert_eq!(desk.working(at), once);
        // Longest-held first, so the one to worry about is at the top.
        assert_eq!(
            once.iter()
                .map(|one| one.holder.as_str())
                .collect::<Vec<_>>(),
            ["ana", "ben", "cass"]
        );
        assert_eq!(once[0].for_ms, 3000);
    }
}
