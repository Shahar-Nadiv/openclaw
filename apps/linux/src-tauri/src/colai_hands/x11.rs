//! The X protocol half of an agent's hands.
//!
//! Split from `colai_hands` because the two halves are different jobs: that file decides
//! what an action means, and this one is the only place in colai that speaks Xlib. The
//! boundary is `Doing` — a resolved intention with no protocol in it — which is also why
//! the whole vocabulary can be tested with no display attached.

use super::{Doing, Hand, Honours, Spot};
use std::collections::HashMap;
use std::ffi::{c_char, c_double, c_int, c_uchar, c_uint, c_ulong, c_void, CStr, CString};

#[link(name = "X11")]
unsafe extern "C" {
    fn XOpenDisplay(name: *const c_char) -> *mut c_void;
    fn XCloseDisplay(display: *mut c_void) -> c_int;
    fn XDefaultRootWindow(display: *mut c_void) -> c_ulong;
    fn XFlush(display: *mut c_void) -> c_int;
    fn XSync(display: *mut c_void, discard: c_int) -> c_int;
    fn XStringToKeysym(name: *const c_char) -> c_ulong;
    fn XKeysymToKeycode(display: *mut c_void, keysym: c_ulong) -> c_uchar;
    fn XkbKeycodeToKeysym(
        display: *mut c_void,
        code: c_uchar,
        group: c_int,
        level: c_int,
    ) -> c_ulong;
    fn XSetErrorHandler(
        handler: Option<unsafe extern "C" fn(*mut c_void, *mut c_void) -> c_int>,
    ) -> *mut c_void;
}

#[link(name = "Xi")]
unsafe extern "C" {
    fn XIQueryDevice(
        display: *mut c_void,
        deviceid: c_int,
        ndevices: *mut c_int,
    ) -> *mut XIDeviceInfo;
    fn XIFreeDeviceInfo(info: *mut XIDeviceInfo);
    fn XIChangeHierarchy(display: *mut c_void, changes: *mut c_void, num_changes: c_int) -> c_int;
    #[allow(clippy::too_many_arguments)]
    fn XIWarpPointer(
        display: *mut c_void,
        deviceid: c_int,
        src_win: c_ulong,
        dst_win: c_ulong,
        src_x: c_double,
        src_y: c_double,
        src_width: c_uint,
        src_height: c_uint,
        dst_x: c_double,
        dst_y: c_double,
    ) -> c_int;
    #[allow(clippy::too_many_arguments)]
    fn XIQueryPointer(
        display: *mut c_void,
        deviceid: c_int,
        win: c_ulong,
        root: *mut c_ulong,
        child: *mut c_ulong,
        root_x: *mut c_double,
        root_y: *mut c_double,
        win_x: *mut c_double,
        win_y: *mut c_double,
        buttons: *mut XIButtonState,
        mods: *mut XIModifierState,
        group: *mut XIModifierState,
    ) -> c_int;
    fn XISetClientPointer(display: *mut c_void, win: c_ulong, deviceid: c_int) -> c_int;
    fn XISetFocus(display: *mut c_void, deviceid: c_int, focus: c_ulong, time: c_ulong) -> c_int;
}

#[link(name = "Xtst")]
unsafe extern "C" {
    fn XTestFakeButtonEvent(
        display: *mut c_void,
        button: c_uint,
        is_press: c_int,
        delay: c_ulong,
    ) -> c_int;
    fn XTestFakeKeyEvent(
        display: *mut c_void,
        keycode: c_uint,
        is_press: c_int,
        delay: c_ulong,
    ) -> c_int;
}

#[repr(C)]
struct XIDeviceInfo {
    deviceid: c_int,
    name: *mut c_char,
    used_as: c_int,
    attachment: c_int,
    enabled: c_int,
    num_classes: c_int,
    classes: *mut c_void,
}

#[repr(C)]
struct XIAddMasterInfo {
    kind: c_int,
    name: *mut c_char,
    send_core: c_int,
    enable: c_int,
}

#[repr(C)]
struct XIRemoveMasterInfo {
    kind: c_int,
    deviceid: c_int,
    return_mode: c_int,
    return_pointer: c_int,
    return_keyboard: c_int,
}

#[repr(C)]
struct XIButtonState {
    mask_len: c_int,
    mask: *mut c_uchar,
}

#[repr(C)]
#[derive(Default)]
struct XIModifierState {
    base: c_int,
    latched: c_int,
    locked: c_int,
    effective: c_int,
}

const XI_ALL_DEVICES: c_int = 0;
const XI_ADD_MASTER: c_int = 1;
const XI_REMOVE_MASTER: c_int = 2;
const XI_ATTACH_TO_MASTER: c_int = 1;
const XI_MASTER_POINTER: c_int = 1;
const XI_MASTER_KEYBOARD: c_int = 2;
/// The pair every X session starts with, and the one a removed master's slaves are
/// handed back to. Fixed by the protocol, not guessed.
const CORE_POINTER: c_int = 2;
const CORE_KEYBOARD: c_int = 3;
const XK_SHIFT_L: c_ulong = 0xffe1;
/// The prefix on every device colai makes, so a stray one is recognisable as ours by
/// somebody reading `xinput list` and wondering where it came from.
const OURS: &str = "colai ";

/// Xlib ends the process on a protocol error unless something says otherwise. Every call
/// here names a window or a device that somebody else can destroy between one request
/// and the next, and a `BadWindow` on a click must not take colai with it.
unsafe extern "C" fn ignore(_display: *mut c_void, _error: *mut c_void) -> c_int {
    0
}

/// A pointer and keyboard pair that colai made.
///
/// The fields are private and the only constructor is `Crew::make`. That is the whole
/// safety argument for this file: an action takes one of these, and the only ones in
/// existence name devices colai created — so no code path, no argument, no deserialised
/// payload and no mistake can point an agent at the pointer in somebody's hand. A shape
/// rather than a check, so there is nothing to forget.
struct Hands {
    pointer: c_int,
    keyboard: c_int,
}

pub(super) struct Crew {
    display: *mut c_void,
    root: c_ulong,
    hands: HashMap<String, Hands>,
}

impl Crew {
    pub(super) fn open() -> Option<Self> {
        // A connection of its own, so nothing here can disturb the one GTK is using for
        // the toolbar's own window on the main thread.
        let display = unsafe { XOpenDisplay(std::ptr::null()) };
        if display.is_null() {
            return None;
        }
        unsafe { XSetErrorHandler(Some(ignore)) };
        Some(Self {
            root: unsafe { XDefaultRootWindow(display) },
            hands: HashMap::new(),
            display,
        })
    }

    /// Every master pair the server currently has, as (name, pointer, keyboard).
    fn masters(&self) -> Vec<(String, c_int, c_int)> {
        let mut count: c_int = 0;
        let all = unsafe { XIQueryDevice(self.display, XI_ALL_DEVICES, &mut count) };
        if all.is_null() || count <= 0 {
            return Vec::new();
        }
        let mut pointers: HashMap<String, c_int> = HashMap::new();
        let mut keyboards: HashMap<String, c_int> = HashMap::new();
        for at in 0..count as isize {
            let one = unsafe { &*all.offset(at) };
            if one.name.is_null() {
                continue;
            }
            let Ok(name) = (unsafe { CStr::from_ptr(one.name) }).to_str() else {
                continue;
            };
            // X names a created pair "<what was asked for> pointer" and "… keyboard".
            // Matching that suffix is how the two halves of one pair find each other
            // again, since the request that makes them returns no ids at all.
            if one.used_as == XI_MASTER_POINTER {
                if let Some(stem) = name.strip_suffix(" pointer") {
                    pointers.insert(stem.to_string(), one.deviceid);
                }
            } else if one.used_as == XI_MASTER_KEYBOARD {
                if let Some(stem) = name.strip_suffix(" keyboard") {
                    keyboards.insert(stem.to_string(), one.deviceid);
                }
            }
        }
        unsafe { XIFreeDeviceInfo(all) };
        pointers
            .into_iter()
            .filter_map(|(stem, pointer)| {
                let keyboard = *keyboards.get(&stem)?;
                Some((stem, pointer, keyboard))
            })
            .collect()
    }

    /// What X calls this agent's pair.
    fn called(agent: &str) -> String {
        format!("{OURS}{agent}")
    }

    /// Make this agent a pair, or hand back the one it already has.
    fn make(&mut self, agent: &str) -> Result<(), String> {
        if self.hands.contains_key(agent) {
            return Ok(());
        }
        let called = Self::called(agent);
        let Ok(name) = CString::new(called.clone()) else {
            return Err("that agent's name cannot be an X device name".into());
        };
        let mut add = XIAddMasterInfo {
            kind: XI_ADD_MASTER,
            name: name.as_ptr() as *mut c_char,
            send_core: 1,
            enable: 1,
        };
        unsafe {
            XIChangeHierarchy(self.display, &raw mut add as *mut c_void, 1);
            // Synced rather than flushed: the ids have to exist before they are looked
            // up, and a request still in the output buffer has created nothing at all.
            XSync(self.display, 0);
        }
        let Some((_, pointer, keyboard)) = self
            .masters()
            .into_iter()
            .find(|(stem, _, _)| *stem == called)
        else {
            return Err("this desktop's X server made no second pointer".into());
        };
        self.hands
            .insert(agent.to_string(), Hands { pointer, keyboard });
        Ok(())
    }

    pub(super) fn unmake(&mut self, agent: &str) {
        if let Some(hands) = self.hands.remove(agent) {
            self.remove_master(hands.pointer);
        }
    }

    pub(super) fn unmake_all(&mut self) {
        for (_, hands) in std::mem::take(&mut self.hands) {
            self.remove_master(hands.pointer);
        }
        // And anything an earlier colai left behind. A crash skips every tidy-up path
        // there is, and the evidence it leaves is a cursor on somebody's desktop that
        // nothing on the machine can account for.
        for (stem, pointer, _) in self.masters() {
            if stem.starts_with(OURS) {
                self.remove_master(pointer);
            }
        }
    }

    fn remove_master(&self, pointer: c_int) {
        let mut remove = XIRemoveMasterInfo {
            kind: XI_REMOVE_MASTER,
            deviceid: pointer,
            // Anything attached goes back to the pair the person is using rather than
            // being left floating, which is another word for dead. Nothing physical is
            // ever attached to ours — but a return mode is not the place to rely on that.
            return_mode: XI_ATTACH_TO_MASTER,
            return_pointer: CORE_POINTER,
            return_keyboard: CORE_KEYBOARD,
        };
        unsafe {
            XIChangeHierarchy(self.display, &raw mut remove as *mut c_void, 1);
            XSync(self.display, 0);
        }
    }

    /// Where one master's cursor is, in root coordinates.
    fn at(&self, device: c_int) -> Option<(f64, f64)> {
        let (mut root, mut child): (c_ulong, c_ulong) = (0, 0);
        let (mut rx, mut ry, mut wx, mut wy) = (0.0, 0.0, 0.0, 0.0);
        let mut buttons = XIButtonState {
            mask_len: 0,
            mask: std::ptr::null_mut(),
        };
        let mut mods = XIModifierState::default();
        let mut group = XIModifierState::default();
        let ok = unsafe {
            XIQueryPointer(
                self.display,
                device,
                self.root,
                &mut root,
                &mut child,
                &mut rx,
                &mut ry,
                &mut wx,
                &mut wy,
                &mut buttons,
                &mut mods,
                &mut group,
            )
        };
        (ok != 0).then_some((rx, ry))
    }

    /// Whether any agent currently has hands.
    ///
    /// The gate on polling at all: with nobody working there is nothing to draw, and a
    /// desktop at rest should cost no X round trips whatever.
    pub(super) fn busy(&self) -> bool {
        !self.hands.is_empty()
    }

    /// Where every agent's cursor is now.
    ///
    /// Sorted by name so the list does not reorder itself between two identical looks —
    /// a `HashMap` iterates differently every time, and that alone would read as movement
    /// and keep the fast poll running for ever.
    pub(super) fn cursors(&self) -> Vec<Hand> {
        let mut all: Vec<Hand> = self
            .hands
            .iter()
            .filter_map(|(agent, hands)| {
                let (x, y) = self.at(hands.pointer)?;
                Some(Hand {
                    agent: agent.clone(),
                    x,
                    y,
                })
            })
            .collect();
        all.sort_by(|a, b| a.agent.cmp(&b.agent));
        all
    }

    /// The desktop's own pointer — the one in somebody's hand.
    ///
    /// Found rather than hardcoded to 2, and only ever read. It exists here for one
    /// purpose: to prove, by measurement, that it did not move.
    fn theirs(&self) -> Option<c_int> {
        self.masters()
            .into_iter()
            .find(|(stem, _, _)| !stem.starts_with(OURS))
            .map(|(_, pointer, _)| pointer)
    }

    /// Try it, rather than believe anything about it.
    ///
    /// Make a pair, move its cursor, and check two things: that it went where it was
    /// sent, and that the person's own pointer did not go with it. The second is the one
    /// that matters. A desktop where both cursors move together is worse than one with
    /// no second cursor at all, because it looks like it is working.
    pub(super) fn honours(&mut self) -> Honours {
        let Some(theirs) = self.theirs() else {
            return Honours::No {
                why: "this display has no master pointer to compare against".into(),
            };
        };
        let was = self.at(theirs);

        let probe = "probe";
        if let Err(why) = self.make(probe) {
            return Honours::No { why };
        }
        let Some(hands) = self.hands.get(probe) else {
            return Honours::No {
                why: "the pair went missing between making it and using it".into(),
            };
        };
        let (to_x, to_y) = (240.0, 240.0);
        self.point(hands.pointer, Some((to_x, to_y)));
        unsafe { XSync(self.display, 0) };

        let went = self
            .at(hands.pointer)
            .is_some_and(|(x, y)| (x - to_x).abs() < 2.0 && (y - to_y).abs() < 2.0);
        let now = self.at(theirs);
        let stayed = was == now;

        // Put theirs back if it came along for the ride. This is restoring something the
        // measurement disturbed, not driving it — leaving somebody's cursor parked where
        // a probe dropped it would be its own small bug.
        if !stayed {
            if let Some((x, y)) = was {
                self.point(theirs, Some((x, y)));
                unsafe { XSync(self.display, 0) };
            }
        }
        self.unmake(probe);

        match (went, stayed) {
            (true, true) => Honours::Yes,
            (false, _) => Honours::No {
                why: "a second cursor was made, but would not move".into(),
            },
            (_, false) => Honours::No {
                why: "moving the second cursor moved this desktop's own pointer too".into(),
            },
        }
    }

    pub(super) fn act(&mut self, agent: &str, window: u64, what: &Doing) -> Result<(), String> {
        self.make(agent)?;
        let Some(hands) = self.hands.get(agent) else {
            return Err("that agent has no hands".into());
        };
        let (pointer, keyboard) = (hands.pointer, hands.keyboard);

        match what {
            Doing::Nothing => return Ok(()),
            Doing::Point(at) => self.point(pointer, *at),
            Doing::Press { at, button, times } => {
                self.point(pointer, *at);
                self.through(pointer);
                for _ in 0..(*times).max(1) {
                    unsafe {
                        XTestFakeButtonEvent(self.display, *button, 1, 0);
                        XTestFakeButtonEvent(self.display, *button, 0, 0);
                    }
                }
            }
            Doing::Wheel {
                at,
                button,
                notches,
            } => {
                self.point(pointer, *at);
                self.through(pointer);
                for _ in 0..(*notches).max(1) {
                    unsafe {
                        XTestFakeButtonEvent(self.display, *button, 1, 0);
                        XTestFakeButtonEvent(self.display, *button, 0, 0);
                    }
                }
            }
            Doing::Write(text) => {
                self.listen(keyboard, window);
                self.through(pointer);
                for letter in text.chars() {
                    self.press(keysym_for(letter))?;
                }
            }
            Doing::Chord(combo) => {
                self.listen(keyboard, window);
                self.through(pointer);
                self.chord(combo)?;
            }
        }
        unsafe { XFlush(self.display) };
        Ok(())
    }

    /// Move this agent's cursor — its own, not anybody's. `XIWarpPointer` takes the
    /// device, so there is no shared pointer being borrowed and hurriedly put back.
    fn point(&self, pointer: c_int, at: Spot) {
        // No coordinates means "where this agent's cursor already is", which is how a
        // second click on the same spot and the end of a drag are expressed.
        let Some((x, y)) = at else {
            return;
        };
        unsafe {
            XIWarpPointer(self.display, pointer, 0, self.root, 0.0, 0.0, 0, 0, x, y);
            XFlush(self.display);
        }
    }

    /// Send what follows through this agent's pair rather than the desktop's.
    ///
    /// XTest has no device argument: its events go to whichever master this connection
    /// is assigned to. So the assignment is set immediately before every burst — one
    /// connection serves every agent, and otherwise the last one to act would still own
    /// it.
    fn through(&self, pointer: c_int) {
        unsafe { XISetClientPointer(self.display, 0, pointer) };
    }

    /// Point this agent's keyboard at the window it is working in.
    ///
    /// Per-master focus is the reason typing is safe at all: keys go where *this*
    /// keyboard is looking, not where the person's is. A window of 0 means the caller did
    /// not say, and then the existing focus is left alone rather than cleared.
    fn listen(&self, keyboard: c_int, window: u64) {
        if window != 0 {
            unsafe { XISetFocus(self.display, keyboard, window as c_ulong, 0) };
        }
    }

    /// One character, with shift held if this layout needs it.
    fn press(&self, keysym: c_ulong) -> Result<(), String> {
        let code = unsafe { XKeysymToKeycode(self.display, keysym) };
        if code == 0 {
            // Said rather than skipped. A tool that silently drops the one character
            // that mattered is the worst kind of working.
            return Err(format!("no key on this layout types keysym {keysym:#x}"));
        }
        // Which shift level the character sits at, asked of the keymap. That beats
        // assuming uppercase means shifted, which on plenty of layouts it does not.
        let plain = unsafe { XkbKeycodeToKeysym(self.display, code, 0, 0) };
        let shifted = plain != keysym;
        let shift = unsafe { XKeysymToKeycode(self.display, XK_SHIFT_L) };
        let holding = shifted && shift != 0;
        unsafe {
            if holding {
                XTestFakeKeyEvent(self.display, shift as c_uint, 1, 0);
            }
            XTestFakeKeyEvent(self.display, code as c_uint, 1, 0);
            XTestFakeKeyEvent(self.display, code as c_uint, 0, 0);
            if holding {
                XTestFakeKeyEvent(self.display, shift as c_uint, 0, 0);
            }
        }
        Ok(())
    }

    /// `ctrl+shift+s`, held in that order and let go in the other.
    fn chord(&self, combo: &str) -> Result<(), String> {
        let mut codes = Vec::new();
        for part in combo
            .split('+')
            .map(str::trim)
            .filter(|part| !part.is_empty())
        {
            let Some(keysym) = named_keysym(part) else {
                return Err(format!("no key is called {part:?}"));
            };
            let code = unsafe { XKeysymToKeycode(self.display, keysym) };
            if code == 0 {
                return Err(format!("this layout has no {part:?} key"));
            }
            codes.push(code);
        }
        if codes.is_empty() {
            return Err("that chord names no keys".into());
        }
        unsafe {
            for code in &codes {
                XTestFakeKeyEvent(self.display, *code as c_uint, 1, 0);
            }
            // Released backwards, so a modifier is never let go while the key it was
            // modifying is still down.
            for code in codes.iter().rev() {
                XTestFakeKeyEvent(self.display, *code as c_uint, 0, 0);
            }
        }
        Ok(())
    }
}

impl Drop for Crew {
    fn drop(&mut self) {
        self.unmake_all();
        unsafe { XCloseDisplay(self.display) };
    }
}

/// The keysym for one character somebody wants typed.
///
/// Latin-1 is its own keysym, which covers most of what gets typed and costs no lookup.
/// Everything above it has a Unicode keysym, which is the code point in a high range —
/// the convention X settled on, so emoji and Hebrew type as themselves rather than as a
/// refusal.
fn keysym_for(letter: char) -> c_ulong {
    match letter {
        '\n' => 0xff0d,
        '\t' => 0xff09,
        other if (other as u32) >= 0x20 && (other as u32) <= 0xff => other as c_ulong,
        other => other as c_ulong | 0x0100_0000,
    }
}

/// The keysym for a key called something — `ctrl`, `Return`, `a`.
fn named_keysym(part: &str) -> Option<c_ulong> {
    // The spellings people actually write, mapped to the ones X knows. Anything not
    // listed is passed through, so every X keysym name still works.
    let name = match part.to_ascii_lowercase().as_str() {
        "ctrl" | "control" => "Control_L",
        "alt" | "option" => "Alt_L",
        "shift" => "Shift_L",
        "super" | "cmd" | "meta" | "win" => "Super_L",
        "enter" | "return" => "Return",
        "esc" | "escape" => "Escape",
        "del" | "delete" => "Delete",
        "backspace" => "BackSpace",
        "space" => "space",
        "tab" => "Tab",
        "up" => "Up",
        "down" => "Down",
        "left" => "Left",
        "right" => "Right",
        _ => part,
    };
    let Ok(text) = CString::new(name) else {
        return None;
    };
    let keysym = unsafe { XStringToKeysym(text.as_ptr()) };
    (keysym != 0).then_some(keysym)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_character_maps_to_the_keysym_x_uses_for_it() {
        // Latin-1 is its own keysym, and that is most typing.
        assert_eq!(keysym_for('a'), 0x61);
        assert_eq!(keysym_for('A'), 0x41);
        assert_eq!(keysym_for(' '), 0x20);
        assert_eq!(keysym_for('é'), 0xe9);
        // The two whitespace characters that are keys rather than letters.
        assert_eq!(keysym_for('\n'), 0xff0d);
        assert_eq!(keysym_for('\t'), 0xff09);
        // Everything else goes to the Unicode range rather than being refused, so a
        // prompt containing an emoji or Hebrew types instead of failing.
        assert_eq!(keysym_for('→'), 0x0100_2192);
        assert_eq!(keysym_for('א'), 0x0100_05d0);
    }

    #[test]
    fn the_spellings_people_write_reach_the_keys_x_names() {
        // Every one of these is a name X itself does not know.
        for (wrote, means) in [
            ("ctrl", "Control_L"),
            ("Ctrl", "Control_L"),
            ("cmd", "Super_L"),
            ("enter", "Return"),
            ("esc", "Escape"),
            ("backspace", "BackSpace"),
        ] {
            assert_eq!(
                named_keysym(wrote),
                named_keysym(means),
                "{wrote} should be {means}"
            );
        }
        // And a name X does know is passed straight through rather than mangled.
        assert!(named_keysym("F5").is_some());
        assert!(named_keysym("Return").is_some());
        // Something that is not a key at all is nothing, not a wrong key.
        assert_eq!(named_keysym("wharrgarbl"), None);
    }

    #[test]
    fn a_pair_is_named_so_a_stray_one_is_traceable_to_us() {
        assert_eq!(Crew::called("ana"), "colai ana");
        assert!(Crew::called("ana").starts_with(OURS));
    }
}
