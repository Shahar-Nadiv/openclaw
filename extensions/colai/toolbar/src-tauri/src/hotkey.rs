// The one way in that does not require the toolbar to already have your attention.
//
// Every other shortcut this program offers is a single letter handled by the page, and
// the page only hears a key once the overlay has taken the keyboard — which it does when
// a panel opens and at no other time. So the rail advertised eleven shortcuts that could
// not be reached from the desktop, which is where somebody is when they want to mark
// something. `V`, `P`, `D` and `B` were decoration.
//
// This is the binding that fixes that: it brings the toolbar up and hands it the
// keyboard, so the letters mean what the keys say they mean.

use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// What the toolbar answers to when nothing has said otherwise.
///
/// Chosen for being unclaimed rather than for being memorable: Super belongs to the
/// desktop on GNOME and KDE both, Alt+Space is the window menu on several, and Ctrl+Space
/// is an input-method switch wherever one is installed. This is a three-finger chord
/// nobody else wants.
pub(crate) const BY_DEFAULT: &str = "Ctrl+Alt+Space";

/// The binding to use, from the environment or the default.
///
/// Read from the environment because the plugin that starts this process is where a
/// user's configuration already lives — putting a second settings file beside it would
/// give the same answer two homes.
pub(crate) fn wanted() -> String {
    match std::env::var("COLAI_HOTKEY") {
        Ok(said) if !said.trim().is_empty() => said.trim().to_string(),
        _ => BY_DEFAULT.to_string(),
    }
}

/// Bring the toolbar to the front and give it the keyboard, or put it away.
///
/// Three states rather than two, because "showing" and "listening" are different things
/// here and the middle one is the common case. Pressed while the toolbar is on screen but
/// not holding the keyboard — which is how it spends nearly all of its time, since it
/// must not steal focus from the work it sits over — this hands it the keyboard so the
/// letters work. Only a press while it is already listening puts it away.
fn summoned(app: &AppHandle) {
    let showing = crate::colai::toolbar_is_showing(app);
    if !showing {
        if let Err(trouble) = crate::colai::colai_summon(app.clone()) {
            eprintln!("[colai] hotkey could not open the toolbar: {trouble}");
            return;
        }
        let _ = crate::colai::colai_take_keyboard(app.clone());
        return;
    }

    let listening = app
        .get_webview_window(crate::colai::OVERLAY_LABEL)
        .and_then(|window| window.is_focused().ok())
        .unwrap_or(false);

    if listening {
        let _ = crate::colai::colai_release(app.clone());
    } else {
        let _ = crate::colai::colai_take_keyboard(app.clone());
    }
}

/// Register the binding, and say plainly if the desktop already has it.
///
/// Not fatal. A chord another program grabbed first is a thing to tell somebody about,
/// not a reason to refuse to run a toolbar that works perfectly well without it — and
/// failing to start over a keyboard shortcut would be the worst possible trade.
pub(crate) fn listen(app: &AppHandle) {
    let said = wanted();
    let chord: Shortcut = match said.parse() {
        Ok(chord) => chord,
        Err(trouble) => {
            eprintln!("[colai] “{said}” is not a shortcut this can bind ({trouble}). Using none.");
            return;
        }
    };

    let handle = app.clone();
    let asked = app.global_shortcut().on_shortcut(chord, move |_app, _chord, event| {
        // Once per press. Without this the binding fires again on release and the
        // toolbar opens and closes in the same gesture.
        if event.state() == ShortcutState::Pressed {
            summoned(&handle);
        }
    });

    match asked {
        Ok(()) => eprintln!("[colai] {said} opens the toolbar."),
        Err(trouble) => eprintln!(
            "[colai] {said} is already taken by something else, so there is no global shortcut ({trouble}). Set COLAI_HOTKEY to choose another."
        ),
    }
}
