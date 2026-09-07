//! Which window somebody is actually looking at, moment to moment.
//!
//! A mark is a place in an application, not a place on the desktop. To draw one only
//! while its own window is in front — and at that window's rectangle *now* rather than
//! the one it had when the mark was made — the page needs to be told about the front
//! window as it changes. That is all this does: watch, and say when it differs.
//!
//! Read straight from X rather than through `xprop` and `xwininfo`. Those spawn a process
//! per question, which is fine for the once-per-mark question they answer elsewhere and
//! absurd several times a second. Three small round trips on a socket cost microseconds.
//!
//! Polled rather than driven by events. Xlib's event masks would be cheaper again, but
//! they bring error handlers, races on windows that die between the select and the read,
//! and a second event loop; a tenth of a second of latency on "which window is in front"
//! is not worth any of that. What matters for cost is that nothing is *sent* unless the
//! answer changed, and that is the part with a test on it.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter as _, Manager as _, Runtime};

/// How often the front window is looked at.
///
/// Fast enough that switching application feels like the marks were never there, slow
/// enough to be free. Each look is three X round trips on a local socket.
const LOOK_EVERY: std::time::Duration = std::time::Duration::from_millis(120);

/// The event the page listens for.
pub(crate) const FRONT_EVENT: &str = "colai:front";

/// The window in front, as much of it as decides whether a mark is drawn.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InFront {
    /// The X window id, as the same hex string a mark's address already carries. Empty
    /// when nothing is in front, which is an answer rather than the lack of one.
    pub id: String,
    pub title: Option<String>,
    /// Where it is now. A mark is drawn from this rather than from the rectangle the
    /// window had when it was made, which is what makes marks ride along when it moves.
    pub at: Option<crate::colai::Rect>,
    /// Ours. The overlay takes the keyboard whenever a popup opens, so without this
    /// every mark would vanish the instant somebody reached for the toolbar — including
    /// the one whose popup they just opened.
    pub ours: bool,
}

/// The last look, kept so it can be asked for.
///
/// The watcher only speaks when the answer changes, which means the first thing it says
/// is said at startup — before the page exists to hear it. Without somewhere to ask, a
/// toolbar opened onto a desktop nobody then touches never learns which window is in
/// front, and every mark stays pinned to the screen exactly as it did before any of this
/// was written. That was the bug: not the tracking, the not-knowing.
static LAST_LOOK: Mutex<Option<InFront>> = Mutex::new(None);

/// What is in front right now, as far as the watcher has seen.
#[tauri::command]
pub(crate) fn colai_in_front() -> Option<InFront> {
    LAST_LOOK.lock().ok().and_then(|held| held.clone())
}

/// Start watching, once, for the life of the app.
pub(crate) fn watch_the_front<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(target_os = "linux")]
    {
        let app = app.clone();
        let running = Arc::new(AtomicBool::new(true));
        app.manage(Watching(running.clone()));
        std::thread::spawn(move || {
            let Some(mut eyes) = x11::Eyes::open() else {
                // No X display: nothing to watch and nothing to say about it. The page
                // draws every mark, which is exactly what it did before this existed.
                return;
            };
            let mut said: Option<InFront> = None;
            while running.load(Ordering::Relaxed) {
                let now = eyes.in_front();
                if let Ok(mut held) = LAST_LOOK.lock() {
                    held.clone_from(&now);
                }
                if changed(said.as_ref(), now.as_ref()) {
                    let _ = app.emit_to(crate::colai::OVERLAY_LABEL, FRONT_EVENT, now.clone());
                    said = now;
                }
                std::thread::sleep(LOOK_EVERY);
            }
        });
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
    }
}

/// Held so the thread stops when the app does.
struct Watching(#[allow(dead_code)] Arc<AtomicBool>);

/// Whether the answer is worth sending.
///
/// The whole cost of watching. Somebody working in one window produces one of these
/// every tenth of a second and none of them are worth a message, so the comparison is
/// the thing that keeps this free — and being a plain function, it is the thing that can
/// be shown to be right.
fn changed(said: Option<&InFront>, now: Option<&InFront>) -> bool {
    match (said, now) {
        (None, None) => false,
        (Some(said), Some(now)) => said != now,
        _ => true,
    }
}

#[cfg(target_os = "linux")]
mod x11 {
    use super::InFront;
    use crate::colai::Rect;
    use std::ffi::{c_char, c_int, c_long, c_uchar, c_ulong, c_void, CString};

    #[link(name = "X11")]
    unsafe extern "C" {
        fn XOpenDisplay(name: *const c_char) -> *mut c_void;
        fn XDefaultRootWindow(display: *mut c_void) -> c_ulong;
        fn XInternAtom(display: *mut c_void, name: *const c_char, only_if_exists: c_int)
            -> c_ulong;
        #[allow(clippy::too_many_arguments)]
        fn XGetWindowProperty(
            display: *mut c_void,
            window: c_ulong,
            property: c_ulong,
            long_offset: c_long,
            long_length: c_long,
            delete: c_int,
            req_type: c_ulong,
            actual_type: *mut c_ulong,
            actual_format: *mut c_int,
            nitems: *mut c_ulong,
            bytes_after: *mut c_ulong,
            prop: *mut *mut c_uchar,
        ) -> c_int;
        fn XGetGeometry(
            display: *mut c_void,
            drawable: c_ulong,
            root: *mut c_ulong,
            x: *mut c_int,
            y: *mut c_int,
            width: *mut u32,
            height: *mut u32,
            border: *mut u32,
            depth: *mut u32,
        ) -> c_int;
        #[allow(clippy::too_many_arguments)]
        fn XTranslateCoordinates(
            display: *mut c_void,
            src: c_ulong,
            dest: c_ulong,
            src_x: c_int,
            src_y: c_int,
            dest_x: *mut c_int,
            dest_y: *mut c_int,
            child: *mut c_ulong,
        ) -> c_int;
        fn XFree(data: *mut c_void) -> c_int;
        fn XSetErrorHandler(
            handler: Option<unsafe extern "C" fn(*mut c_void, *mut c_void) -> c_int>,
        ) -> *mut c_void;
        fn XSync(display: *mut c_void, discard: c_int) -> c_int;
    }

    /// Xlib kills the process on a protocol error unless something says otherwise.
    ///
    /// Not a nicety. Every read here is about a window somebody else owns, and the gap
    /// between learning its id and asking about it is long enough for them to close it —
    /// a `BadWindow` at that moment, with the default handler, ends colai. Ignored is the
    /// correct answer: a window that has gone is a window that is not in front.
    unsafe extern "C" fn ignore(_display: *mut c_void, _error: *mut c_void) -> c_int {
        0
    }

    pub(super) struct Eyes {
        display: *mut c_void,
        root: c_ulong,
        active: c_ulong,
        name: c_ulong,
        utf8: c_ulong,
        pid: c_ulong,
        ours: u32,
    }

    impl Eyes {
        pub(super) fn open() -> Option<Self> {
            // A connection of its own, so nothing here can disturb the one GTK is using
            // for the toolbar's own window on the main thread.
            let display = unsafe { XOpenDisplay(std::ptr::null()) };
            if display.is_null() {
                return None;
            }
            unsafe { XSetErrorHandler(Some(ignore)) };
            let atom = |name: &str| -> c_ulong {
                let Ok(text) = CString::new(name) else {
                    return 0;
                };
                unsafe { XInternAtom(display, text.as_ptr(), 0) }
            };
            Some(Self {
                root: unsafe { XDefaultRootWindow(display) },
                active: atom("_NET_ACTIVE_WINDOW"),
                name: atom("_NET_WM_NAME"),
                utf8: atom("UTF8_STRING"),
                pid: atom("_NET_WM_PID"),
                ours: std::process::id(),
                display,
            })
        }

        pub(super) fn in_front(&mut self) -> Option<InFront> {
            let window = self.one_number(self.root, self.active).unwrap_or(0);
            // 0 is what X reports when nothing has focus — a minimised window, a locked
            // screen, the moment between one window closing and the next taking over.
            //
            // Reported as a window with no id rather than as no answer, because those
            // are different things to the page: "nothing is in front" hides every mark
            // that belongs to an application, and "I could not tell" leaves them alone.
            if window == 0 {
                return Some(InFront::default());
            }
            let front = InFront {
                id: format!("0x{window:x}"),
                title: self.text(window, self.name),
                at: self.rect(window),
                ours: self.one_number(window, self.pid) == Some(self.ours as c_ulong),
            };
            // Errors are ignored rather than fatal, which means a read can silently have
            // failed; syncing here keeps a stale answer from being reported as current.
            unsafe { XSync(self.display, 0) };
            Some(front)
        }

        fn one_number(&self, window: c_ulong, property: c_ulong) -> Option<c_ulong> {
            if property == 0 {
                return None;
            }
            let mut kind: c_ulong = 0;
            let mut format: c_int = 0;
            let mut count: c_ulong = 0;
            let mut after: c_ulong = 0;
            let mut data: *mut c_uchar = std::ptr::null_mut();
            let ok = unsafe {
                XGetWindowProperty(
                    self.display,
                    window,
                    property,
                    0,
                    1,
                    0,
                    0, // AnyPropertyType
                    &mut kind,
                    &mut format,
                    &mut count,
                    &mut after,
                    &mut data,
                )
            };
            if ok != 0 || data.is_null() || count == 0 || format != 32 {
                if !data.is_null() {
                    unsafe { XFree(data.cast()) };
                }
                return None;
            }
            // 32-bit X properties are handed back as an array of `long`, whatever the
            // wire format says — reading them as u32 is the classic way to get half a
            // number on a 64-bit machine.
            let value = unsafe { *(data as *const c_ulong) };
            unsafe { XFree(data.cast()) };
            Some(value)
        }

        fn text(&self, window: c_ulong, property: c_ulong) -> Option<String> {
            if property == 0 {
                return None;
            }
            let mut kind: c_ulong = 0;
            let mut format: c_int = 0;
            let mut count: c_ulong = 0;
            let mut after: c_ulong = 0;
            let mut data: *mut c_uchar = std::ptr::null_mut();
            let ok = unsafe {
                XGetWindowProperty(
                    self.display,
                    window,
                    property,
                    0,
                    // Titles are read only to tell one tab from another, so a long one
                    // can be cut off: what matters is that it changes when the tab does.
                    256,
                    0,
                    self.utf8,
                    &mut kind,
                    &mut format,
                    &mut count,
                    &mut after,
                    &mut data,
                )
            };
            if ok != 0 || data.is_null() || count == 0 {
                if !data.is_null() {
                    unsafe { XFree(data.cast()) };
                }
                return None;
            }
            let bytes = unsafe { std::slice::from_raw_parts(data, count as usize) };
            let said = String::from_utf8_lossy(bytes).trim().to_string();
            unsafe { XFree(data.cast()) };
            (!said.is_empty()).then_some(said)
        }

        /// Where a window is on the desktop, in the desktop's own coordinates.
        ///
        /// `XGetGeometry` answers relative to the parent, and a window manager reparents
        /// almost everything into a frame — so on its own it reports a position inside a
        /// title bar rather than on the screen. Translating to the root is what turns it
        /// into the number a mark can be drawn from.
        fn rect(&self, window: c_ulong) -> Option<Rect> {
            let mut root: c_ulong = 0;
            let (mut x, mut y) = (0, 0);
            let (mut width, mut height, mut border, mut depth) = (0, 0, 0, 0);
            let ok = unsafe {
                XGetGeometry(
                    self.display,
                    window,
                    &mut root,
                    &mut x,
                    &mut y,
                    &mut width,
                    &mut height,
                    &mut border,
                    &mut depth,
                )
            };
            if ok == 0 || width == 0 || height == 0 {
                return None;
            }
            let (mut screen_x, mut screen_y) = (0, 0);
            let mut child: c_ulong = 0;
            unsafe {
                XTranslateCoordinates(
                    self.display,
                    window,
                    self.root,
                    0,
                    0,
                    &mut screen_x,
                    &mut screen_y,
                    &mut child,
                )
            };
            Some(Rect {
                x: screen_x,
                y: screen_y,
                width: width as i32,
                height: height as i32,
            })
        }
    }

    // The display outlives the thread that opened it and is touched by nothing else.
    unsafe impl Send for Eyes {}
}

#[cfg(test)]
mod tests {
    use super::*;

    fn front(id: &str, title: &str) -> InFront {
        InFront {
            id: id.to_string(),
            title: Some(title.to_string()),
            at: Some(crate::colai::Rect {
                x: 100,
                y: 100,
                width: 800,
                height: 600,
            }),
            ours: false,
        }
    }

    #[test]
    fn working_in_one_window_says_nothing() {
        // Eight of these a second, and none of them are news. This comparison is the
        // entire cost of watching.
        let same = front("0x1", "Prices — Shop");
        assert!(!changed(Some(&same), Some(&same.clone())));
        assert!(!changed(None, None));
    }

    #[test]
    fn switching_window_tab_or_place_is_news() {
        let was = front("0x1", "Prices — Shop");
        // Another application.
        assert!(changed(Some(&was), Some(&front("0x2", "Prices — Shop"))));
        // The same window, another tab: one browser window keeps one id, and the title
        // is the only thing that moved.
        assert!(changed(Some(&was), Some(&front("0x1", "Basket — Shop"))));
        // The same window, dragged. Marks ride along, so the page has to hear about it.
        let mut moved = was.clone();
        moved.at = Some(crate::colai::Rect {
            x: 400,
            y: 100,
            width: 800,
            height: 600,
        });
        assert!(changed(Some(&was), Some(&moved)));
    }

    #[test]
    fn the_screen_going_dark_and_coming_back_are_both_news() {
        let was = front("0x1", "Prices — Shop");
        assert!(changed(Some(&was), None));
        assert!(changed(None, Some(&was)));
    }

    #[test]
    fn the_toolbar_taking_the_keyboard_is_a_different_answer() {
        // And has to be, or the page cannot tell "you are looking at something else"
        // from "you reached for the toolbar" — which decides whether every mark on the
        // screen disappears.
        let was = front("0x1", "Prices — Shop");
        let mut ours = was.clone();
        ours.ours = true;
        assert!(changed(Some(&was), Some(&ours)));
    }
}
