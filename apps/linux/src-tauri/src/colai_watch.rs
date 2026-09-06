//! Watching a region, and saying when it changes.
//!
//! Every other tool answers a question about now. This one answers a question about
//! later: mark the panel, go and do something else, and be told when it moves. It is
//! the only thing the toolbar does while nobody is looking at it, which is what makes
//! the rules around it strict.
//!
//! **It fires once.** The first real change sends the before and the after and the
//! watch is over. A watch that kept firing would fill somebody's conversation with a
//! progress bar while they were at lunch.
//!
//! **It gives up.** Nothing here runs forever. A region that never changes stops being
//! watched and says so, because a timer nobody remembers starting is worse than no
//! answer.
//!
//! **It is never quiet.** A watched region keeps a marker on the overlay and the rail
//! counts what is live. Software that watches your screen and does not show it is doing
//! so is software nobody should run, and that is true when it is your own.
//!
//! The picture that gets sent is not taken here. Deciding a region changed is this
//! module's business; photographing it means hiding the toolbar first so it does not
//! appear in its own evidence, and the page is what knows how to do that. So this says
//! "that one moved" and stops, and the page takes it from there.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::colai_capture::{glance_at, moved_by};
use crate::colai_marks::{crop_for, Mark};

/// How often a watch looks.
///
/// Slow on purpose. The thing being waited for takes minutes — a build, a deploy, a
/// test run — and a poll every second would spend a hundred readings to notice
/// something a dozen would have caught, on a machine somebody is trying to work on.
const EVERY: std::time::Duration = std::time::Duration::from_secs(3);
/// How long a watch runs before it decides nothing is coming.
const LONGEST: std::time::Duration = std::time::Duration::from_secs(20 * 60);
/// How different two glances have to be before it counts as something happening.
///
/// Tuned against the noise of a real desktop rather than a theory about pixels: a text
/// cursor blinking inside a watched terminal moves a coarse reading by well under a
/// percent, and a panel opening or a status turning red moves it by many.
const MOVED: f64 = 0.03;
/// How many looks in a row have to disagree with the start before it is believed.
///
/// A pointer crossing the region, a tooltip, a menu opening over it — all of them make
/// one reading differ and the next agree again. Two in a row is the cheapest way to
/// tell a thing that happened from a thing that passed by.
const TWICE: u32 = 2;
/// How many regions may be watched at once.
///
/// A cap rather than a queue: six markers is already a busy screen, and the seventh is
/// a sign somebody is using this for something it is not.
const AT_ONCE: usize = 6;

/// Why a watch is over, in the words the toolbar will use.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Ended {
    mark_id: String,
    /// `changed`, `waited`, or a failure.
    why: String,
    says: Option<String>,
}

const CHANGED_EVENT: &str = "colai:watch-changed";
const ENDED_EVENT: &str = "colai:watch-ended";

/// The watches running now, so they can be stopped.
#[derive(Default)]
pub(crate) struct Watches(Mutex<HashMap<String, Arc<AtomicBool>>>);

impl Watches {
    fn held(&self) -> Result<std::sync::MutexGuard<'_, HashMap<String, Arc<AtomicBool>>>, String> {
        self.0
            .lock()
            .map_err(|_| "The list of watched regions is unavailable.".to_string())
    }

    /// Register a watch, or refuse because there are already enough.
    fn arm(&self, id: &str) -> Result<Arc<AtomicBool>, String> {
        let mut held = self.held()?;
        // Re-arming the same region replaces it rather than doubling it: two watches on
        // one mark would send the same pair twice.
        if let Some(old) = held.remove(id) {
            old.store(true, Ordering::Relaxed);
        }
        if held.len() >= AT_ONCE {
            return Err(format!(
                "There are already {AT_ONCE} regions being watched. Stop one first."
            ));
        }
        let stop = Arc::new(AtomicBool::new(false));
        held.insert(id.to_string(), stop.clone());
        Ok(stop)
    }

    fn disarm(&self, id: &str) -> Result<(), String> {
        if let Some(stop) = self.held()?.remove(id) {
            stop.store(true, Ordering::Relaxed);
        }
        Ok(())
    }

    /// Take a finished watch off the list, but only if it is still the one listed.
    ///
    /// A watch re-armed on the same region replaces the flag in the map while the old
    /// loop is still asleep. When that loop wakes and tidies up after itself, removing
    /// the entry by name would take the *new* watch's flag with it and leave a loop
    /// running that nothing could ever stop.
    fn retire(&self, id: &str, mine: &Arc<AtomicBool>) {
        let Ok(mut held) = self.held() else {
            return;
        };
        if held.get(id).is_some_and(|listed| Arc::ptr_eq(listed, mine)) {
            held.remove(id);
        }
    }

    /// Stop everything. Called when the overlay is put away.
    pub(crate) fn disarm_all(&self) {
        let Ok(mut held) = self.held() else {
            return;
        };
        for (_, stop) in held.drain() {
            stop.store(true, Ordering::Relaxed);
        }
    }
}

/// Start watching the region a mark covers.
///
/// The mark has already been photographed by the ordinary capture path — that picture
/// is the "before", and it was taken with the toolbar hidden, which is why this does
/// not take one of its own.
#[tauri::command]
pub(crate) async fn colai_watch_start(app: AppHandle, mark: Mark) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let (at, crop) = region_of(&app, &mark)?;
        let watches = app.state::<Watches>();
        let stop = watches.arm(&mark.id)?;
        let id = mark.id.clone();
        tauri::async_runtime::spawn(async move {
            let ended = keep_looking(&app, &id, at, crop, &stop).await;
            // Whatever happened, the watch is no longer running, so it is no longer
            // listed. Left in place, the cap would fill up with watches that finished.
            app.state::<Watches>().retire(&id, &stop);
            let event = match ended.why.as_str() {
                "changed" => CHANGED_EVENT,
                // Nothing is said about a watch that was told to stop. Somebody asked
                // for that — the toolbar, or the toolbar going away — and they have
                // already acted on it. Announcing it would also be announcing it under
                // a name a newer watch on the same region may now be using.
                "stopped" => return,
                _ => ENDED_EVENT,
            };
            let _ = app.emit_to(crate::colai::OVERLAY_LABEL, event, ended);
        });
        Ok(())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, mark);
        Err("Watching a region is only built for Linux so far.".to_string())
    }
}

/// Stop watching, because somebody said so.
#[tauri::command]
pub(crate) fn colai_watch_stop(app: AppHandle, mark_id: String) -> Result<(), String> {
    app.state::<Watches>().disarm(&mark_id)
}

/// Where on the display this mark's region is, in the coordinates a capture wants.
#[cfg(target_os = "linux")]
fn region_of(
    app: &AppHandle,
    mark: &Mark,
) -> Result<((i32, i32), crate::colai_marks::Crop), String> {
    let window = app
        .get_webview_window(crate::colai::OVERLAY_LABEL)
        .ok_or_else(|| "The toolbar is not open.".to_string())?;
    let size = window
        .inner_size()
        .map_err(|error| format!("Could not measure the overlay: {error}"))?;
    let at = window
        .outer_position()
        .map_err(|error| format!("Could not find the overlay: {error}"))?;
    let crop = crop_for(mark, size.width as i32, size.height as i32)
        .ok_or_else(|| "There is nothing inside that mark to watch.".to_string())?;
    Ok(((at.x, at.y), crop))
}

/// The loop. Looks, compares, and decides when it has seen enough.
#[cfg(target_os = "linux")]
async fn keep_looking(
    app: &AppHandle,
    id: &str,
    at: (i32, i32),
    crop: crate::colai_marks::Crop,
    stop: &Arc<AtomicBool>,
) -> Ended {
    let where_ = (at.0 + crop.x, at.1 + crop.y, crop.width, crop.height);
    let over = |why: &str, says: Option<String>| Ended {
        mark_id: id.to_string(),
        why: why.to_string(),
        says,
    };

    let first = match look(app, where_).await {
        Ok(seen) => seen,
        Err(trouble) => return over("failed", Some(trouble)),
    };
    let started = std::time::Instant::now();
    let mut differing = 0u32;
    loop {
        tokio::time::sleep(EVERY).await;
        if stop.load(Ordering::Relaxed) {
            return over("stopped", None);
        }
        if started.elapsed() >= LONGEST {
            return over(
                "waited",
                Some(format!(
                    "nothing changed in {} minutes",
                    LONGEST.as_secs() / 60
                )),
            );
        }
        let now = match look(app, where_).await {
            Ok(seen) => seen,
            // A display that will not answer once is a screen locking or a monitor
            // going to sleep, not a reason to give up on the region behind it.
            Err(_) => continue,
        };
        // Against the first reading rather than the last: a change that arrives slowly —
        // a progress bar filling, a panel sliding in — differs from its own previous
        // frame by almost nothing at every step, and would never be noticed at all.
        if moved_by(&first, &now) < MOVED {
            differing = 0;
            continue;
        }
        differing += 1;
        if differing >= TWICE {
            return over("changed", None);
        }
    }
}

/// One reading, taken on the thread GDK belongs to.
#[cfg(target_os = "linux")]
async fn look(app: &AppHandle, at: (i32, i32, i32, i32)) -> Result<Vec<u8>, String> {
    let (done, wait) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = done.send(glance_at(at));
    })
    .map_err(|error| format!("Could not reach the display: {error}"))?;
    wait.recv()
        .map_err(|_| "The display did not answer.".to_string())?
}

#[cfg(test)]
mod tests {
    use crate::colai_capture::moved_by;

    #[test]
    fn a_reading_has_not_moved_from_itself() {
        let seen = vec![10u8, 200, 30, 40];
        assert_eq!(moved_by(&seen, &seen), 0.0);
    }

    #[test]
    fn one_cell_flickering_is_not_a_change_and_half_the_picture_is() {
        // The two cases this number exists to tell apart. A text cursor blinking inside
        // a watched terminal is one cell of many going from light to dark; a panel
        // opening is most of them moving at once.
        let calm = vec![128u8; 24 * 24 * 3];
        let mut blinked = calm.clone();
        for byte in blinked.iter_mut().take(3) {
            *byte = 255;
        }
        assert!(moved_by(&calm, &blinked) < super::MOVED);

        let mut opened = calm.clone();
        for byte in opened.iter_mut().take(calm.len() / 2) {
            *byte = 255;
        }
        assert!(moved_by(&calm, &opened) > super::MOVED);
    }

    #[test]
    fn a_region_that_cannot_be_read_the_same_way_twice_counts_as_moved() {
        // Not as "no change". A watch that quietly stopped noticing would wait out its
        // twenty minutes and report that nothing happened, which is a lie about a
        // region it could no longer see.
        assert_eq!(moved_by(&[1, 2, 3], &[1, 2]), 1.0);
        assert_eq!(moved_by(&[], &[]), 1.0);
    }

    #[test]
    fn a_seventh_watch_is_refused_rather_than_queued() {
        let watches = super::Watches::default();
        for at in 0..super::AT_ONCE {
            watches.arm(&format!("mark-{at}")).unwrap();
        }
        assert!(watches.arm("one-too-many").is_err());
        // And re-arming one already running replaces it, so the same region twice is
        // one watch rather than two sends of the same pair.
        assert!(watches.arm("mark-0").is_ok());
    }

    #[test]
    fn a_finished_watch_does_not_take_its_replacement_with_it() {
        // The race a re-armed region used to lose: the old loop wakes up, tidies away
        // the entry by name, and the new watch is left running with nothing able to
        // stop it and no marker anybody can press.
        let watches = super::Watches::default();
        let first = watches.arm("mark-1").unwrap();
        let second = watches.arm("mark-1").unwrap();
        watches.retire("mark-1", &first);
        assert!(watches.held().unwrap().contains_key("mark-1"));
        watches.retire("mark-1", &second);
        assert!(!watches.held().unwrap().contains_key("mark-1"));
    }

    #[test]
    fn stopping_a_watch_frees_its_place() {
        let watches = super::Watches::default();
        for at in 0..super::AT_ONCE {
            watches.arm(&format!("mark-{at}")).unwrap();
        }
        watches.disarm("mark-3").unwrap();
        assert!(watches.arm("a-new-one").is_ok());
        watches.disarm_all();
        assert!(watches.arm("after-everything-stopped").is_ok());
    }
}
