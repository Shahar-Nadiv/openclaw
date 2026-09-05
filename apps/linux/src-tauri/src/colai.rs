//! Colai's overlay: a sheet of glass over the whole desktop.
//!
//! This is the layer Colai adds to this application. Everything else here — the agent
//! runtime, the gateway, MCP, sessions, credentials, the tray, the updater — is
//! OpenClaw's and is used as it is. What is new is the screen as a workspace: a
//! toolbar over any window, regions marked on it, and a gate that refuses to change a
//! surface no connector owns.
//!
//! Two things make an overlay usable rather than a sheet over somebody's work, and
//! both are here.
//!
//! **The shape.** The window covers the display, and an X input shape decides where
//! Colai actually exists on it. Everywhere else, clicks fall through to the
//! application underneath.
//!
//! Input only — this is `ShapeInput`, not `ShapeBounding`, so an unlisted region still
//! *paints*, it just cannot be clicked. Transparency is what makes the rest invisible,
//! and the two have to agree: a page that draws something outside its reported shape
//! shows a control nobody can press. Which is why the page measures the union of the
//! rail with everything it draws rather than the rail alone.
//!
//! **The way out.** Escape is handled here, in the process that a wedged page cannot
//! wedge. An overlay that catches every click and stops responding is a desktop
//! nobody can use, and there has to be a release that does not go through the webview.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

pub(crate) const OVERLAY_LABEL: &str = "colai-overlay";
pub(crate) const SETTINGS_LABEL: &str = "colai-settings";

/// A region of the overlay that belongs to Colai, in physical pixels.
#[derive(Debug, Clone, Copy, Deserialize)]
pub(crate) struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// The application in front, as a person would name it.
#[derive(Debug, Clone, Serialize)]
pub(crate) struct Front {
    pub app: String,
    pub title: String,
    pub id: String,
}

/// The last shape asked for, so an identical request costs nothing.
///
/// The page recomputes its shape on every render and on every mutation of the rail,
/// which is many times a second while a flyout animates. Each one would otherwise be an
/// X round trip.
#[derive(Default)]
pub(crate) struct ShapeState(Mutex<Option<Vec<(i32, i32, i32, i32)>>>);

/// Make the overlay, or return the one that exists.
///
/// Sized to the monitor rather than fullscreened: a real fullscreen window on X11 asks
/// the window manager to give it a workspace of its own, which is the opposite of what
/// an overlay wants. `skip_taskbar` and no decorations keep it out of the alt-tab list
/// and off the panel — it is not a window somebody switches to, it is a layer.
pub(crate) fn ensure_overlay(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        return Ok(window);
    }

    let window =
        WebviewWindowBuilder::new(app, OVERLAY_LABEL, WebviewUrl::App("overlay.html".into()))
            .title("colai")
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .shadow(false)
            // Not focused on creation. Summoning Colai should not take the keyboard away from
            // whatever somebody is in the middle of typing into.
            .focused(false)
            .visible(false)
            .build()
            .map_err(|error| format!("Could not create the colai overlay: {error}"))?;

    cover_primary(&window)?;
    Ok(window)
}

fn cover_primary(window: &WebviewWindow) -> Result<(), String> {
    let monitor = window
        .primary_monitor()
        .map_err(|error| format!("Could not read the display: {error}"))?
        .ok_or_else(|| "There is no display to draw on.".to_string())?;
    let size = *monitor.size();
    let at = *monitor.position();
    window
        .set_position(PhysicalPosition::new(at.x, at.y))
        .map_err(|error| format!("Could not place the overlay: {error}"))?;
    window
        .set_size(PhysicalSize::new(size.width, size.height))
        .map_err(|error| format!("Could not size the overlay: {error}"))?;
    keep_composited(window);
    Ok(())
}

/// Tell the window manager this is a layer, not a fullscreen application.
///
/// `DOCK` is what this window actually is: a panel-like surface that sits above other
/// windows, takes no focus, and is not something anybody alt-tabs to. Saying so is
/// worth doing on its own — mutter places and stacks a hinted window predictably, where
/// an undecorated `NORMAL` window the exact size of a monitor is a candidate for
/// *unredirection*, and an unredirected window is scanned out without a compositor to
/// blend its alpha against the desktop.
///
/// Whether that unredirection would actually bite here has not been demonstrated: the
/// black screen that first suggested it turned out to be a fullscreen game on the same
/// monitor. The hint stays because it is the correct description of the window, not
/// because it is a proven fix.
#[cfg(target_os = "linux")]
fn keep_composited(window: &WebviewWindow) {
    use gtk::prelude::GtkWindowExt;

    if let Ok(gtk_window) = window.gtk_window() {
        gtk_window.set_type_hint(gdk::WindowTypeHint::Dock);
    }
}

#[cfg(not(target_os = "linux"))]
fn keep_composited(_window: &WebviewWindow) {}

/// Where Colai exists on the screen. Everywhere else belongs to the desktop.
///
/// Through GTK rather than raw X, and that is not a style preference. A shape set with
/// `XShapeCombineRectangles` behind GTK's back lands — X reports it back immediately —
/// and is then undone the moment GTK re-applies its own input region on the next
/// configure. The last writer wins, and GTK writes last. `input_shape_combine_region`
/// makes the shape GTK's own idea of the window, so nothing overwrites it.
#[tauri::command]
pub(crate) fn colai_shape(app: AppHandle, rects: Vec<Rect>) -> Result<(), String> {
    let key: Vec<(i32, i32, i32, i32)> = rects
        .iter()
        .map(|r| (r.x, r.y, r.width, r.height))
        .collect();

    {
        let state = app.state::<ShapeState>();
        let mut held = state
            .0
            .lock()
            .map_err(|_| "shape state poisoned".to_string())?;
        if held.as_deref() == Some(key.as_slice()) {
            return Ok(());
        }
        *held = Some(key.clone());
    }

    let window = app
        .get_webview_window(OVERLAY_LABEL)
        .ok_or_else(|| "The overlay is not open.".to_string())?;

    apply_shape(&window, &key)
}

#[cfg(target_os = "linux")]
fn apply_shape(window: &WebviewWindow, rects: &[(i32, i32, i32, i32)]) -> Result<(), String> {
    use gtk::prelude::WidgetExt;

    let gtk_window = window
        .gtk_window()
        .map_err(|error| format!("Could not reach the overlay's GTK window: {error}"))?;

    /*
     * An empty shape is not "no shape".
     *
     * Clearing the input region entirely gives the window *everything* back, which
     * turns the overlay into a sheet that swallows the desktop. When Colai is drawing
     * nothing, it exists nowhere — which is one pixel, not zero rectangles.
     */
    let region = cairo::Region::create();
    if rects.is_empty() {
        region
            .union_rectangle(&cairo::RectangleInt::new(0, 0, 1, 1))
            .map_err(|error| format!("Could not build the overlay's shape: {error}"))?;
    }
    for (x, y, width, height) in rects {
        region
            .union_rectangle(&cairo::RectangleInt::new(*x, *y, *width, *height))
            .map_err(|error| format!("Could not build the overlay's shape: {error}"))?;
    }

    gtk_window.input_shape_combine_region(Some(&region));
    Ok(())
}

#[cfg(not(target_os = "linux"))]
fn apply_shape(_window: &WebviewWindow, _rects: &[(i32, i32, i32, i32)]) -> Result<(), String> {
    // macOS and Windows reach click-through by other means, and neither is written yet.
    // Reporting success here would make the overlay swallow the desktop on those
    // platforms while looking correct on this one.
    Err("Per-region click-through is implemented for X11 only.".to_string())
}

/// Which application is in front, so a refusal can name it.
///
/// **Provisional.** The surface registry — window to connector, health-polled — is the
/// daemon's job and is not written. Until it is, the toolbar still has to answer "which
/// app is this" or its refusal has nothing to refuse about. `xprop` is read-only, ships
/// with x11-utils on every desktop Ubuntu, and depending on a binary that is already
/// there beats compiling an X binding for something being replaced.
///
/// Null when it cannot tell, which reads as "no connector" — the safe answer rather
/// than the convenient one.
#[tauri::command]
pub(crate) fn colai_frontmost() -> Option<Front> {
    #[cfg(target_os = "linux")]
    {
        frontmost_x11()
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

#[cfg(target_os = "linux")]
fn frontmost_x11() -> Option<Front> {
    use std::process::Command;

    let root = Command::new("xprop")
        .args(["-root", "_NET_ACTIVE_WINDOW"])
        .output()
        .ok()?;
    let said = String::from_utf8_lossy(&root.stdout);
    let id = said
        .split("# ")
        .nth(1)?
        .split(&[',', '\n'][..])
        .next()?
        .trim();
    // 0x0 is what X reports when nothing has focus — a locked screen, or the moment
    // between one window closing and the next taking it.
    if id.is_empty() || id == "0x0" {
        return None;
    }

    let about = Command::new("xprop")
        .args(["-id", id, "WM_CLASS", "_NET_WM_NAME"])
        .output()
        .ok()?;
    let about = String::from_utf8_lossy(&about.stdout);

    Some(Front {
        app: app_name(&about),
        title: window_title(&about),
        id: id.to_string(),
    })
}

/// The application's name, from the second half of WM_CLASS.
///
/// WM_CLASS is a pair — instance then class — and the class is the one that names the
/// program. Firefox reports `"Navigator", "firefox_firefox"`, where the first half is
/// the *kind of window* and would put "Navigator" in front of somebody who has never
/// heard the word. `firefox_firefox` is one word said twice; it is said once here,
/// because that string is an implementation's choice and "Firefox" is what the program
/// is called.
#[cfg(target_os = "linux")]
fn app_name(said: &str) -> String {
    let line = said
        .lines()
        .find(|line| line.starts_with("WM_CLASS"))
        .unwrap_or_default();
    let quoted: Vec<&str> = line.split('"').skip(1).step_by(2).collect();
    let raw = quoted
        .last()
        .or(quoted.first())
        .copied()
        .unwrap_or_default();
    if raw.is_empty() {
        return "that window".to_string();
    }

    let mut seen: Vec<String> = Vec::new();
    for part in raw.split(['-', '_', '.']).filter(|part| !part.is_empty()) {
        let lower = part.to_lowercase();
        if seen.iter().any(|had| had.to_lowercase() == lower) {
            continue;
        }
        let mut chars = part.chars();
        let capitalised = match chars.next() {
            Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
            None => continue,
        };
        seen.push(capitalised);
    }
    if seen.is_empty() {
        "that window".to_string()
    } else {
        seen.join(" ")
    }
}

#[cfg(target_os = "linux")]
fn window_title(said: &str) -> String {
    said.lines()
        .find(|line| line.starts_with("_NET_WM_NAME"))
        .and_then(|line| line.split('"').nth(1))
        .unwrap_or_default()
        .to_string()
}

/// Somebody asked for the toolbar.
#[tauri::command]
pub(crate) fn colai_summon(app: AppHandle) -> Result<(), String> {
    let window = ensure_overlay(&app)?;
    cover_primary(&window)?;
    window
        .show()
        .map_err(|error| format!("Could not show the overlay: {error}"))
}

/// Give the screen back.
#[tauri::command]
pub(crate) fn colai_release(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        window
            .hide()
            .map_err(|error| format!("Could not hide the overlay: {error}"))?;
    }
    if let Some(state) = app.try_state::<ShapeState>() {
        if let Ok(mut held) = state.0.lock() {
            // Forgotten, so the next summon re-applies rather than believing a shape
            // that belonged to a window which is no longer on screen.
            *held = None;
        }
    }
    Ok(())
}

/// Settings — the second and last window Colai has.
#[tauri::command]
pub(crate) fn colai_open_settings(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(SETTINGS_LABEL) {
        let _ = window.show();
        return window
            .set_focus()
            .map_err(|error| format!("Could not focus settings: {error}"));
    }

    WebviewWindowBuilder::new(
        &app,
        SETTINGS_LABEL,
        WebviewUrl::App("settings.html".into()),
    )
    .title("colai Settings")
    .inner_size(980.0, 640.0)
    .min_inner_size(760.0, 520.0)
    .decorations(false)
    .center()
    .build()
    .map_err(|error| format!("Could not open settings: {error}"))?;

    Ok(())
}
