//! The toolbar: a sheet of glass over the whole desktop.
//!
//! A sibling of Quick Chat. Both are small, always-on-top surfaces over the desktop
//! rather than pages of the dashboard, both have their UI in `apps/linux/ui/`, and both
//! are reached from the tray. What this one adds is the screen as a workspace: a toolbar
//! over any window, regions marked on it, and a gate that refuses to change a surface no
//! connector owns.
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

/// The edges of the overlay the desktop's own chrome is using, in physical pixels.
///
/// Colai keeps out of these. It is the only arrangement where both the toolbar and the
/// desktop's panels stay visible, because on GNOME the shell *is* the compositor and
/// draws its panel and dock above every client window — `always_on_top`, a `DOCK` type
/// hint and `_NET_WM_STATE_ABOVE` all lose to it. Measured on this machine: the rail
/// docked to the left edge and Ubuntu's dock drew straight over it.
///
/// The other way to win is a fullscreen window, which makes the shell yield its chrome.
/// That is rejected on two counts. It hides the dock, and somebody using Colai should
/// not lose their desktop to it. And it kills transparency: a fullscreen window is
/// unredirected, scanned out with no compositor to blend its alpha, so the overlay
/// turned into an opaque sheet — sampled at 11,16,29 across a whole monitor.
#[derive(Debug, Clone, Copy, Default, Serialize)]
pub(crate) struct Reserved {
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
    pub left: i32,
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
        WebviewWindowBuilder::new(app, OVERLAY_LABEL, WebviewUrl::App("toolbar.html".into()))
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
    /*
     * Wake the Gateway connection, the way Quick Chat does when its window opens.
     *
     * The client is shared and connects lazily, so a surface that never activates it
     * finds it unreachable no matter how long the app has been running — the toolbar
     * asked for agents and was told "Gateway unreachable — retrying" while the dashboard
     * beside it was connected and fine.
     */
    // `try_state`, because the toolbar can be opened before the client is registered —
    // from the tray during startup, or from the setup hook itself. A missing client means
    // the connection is not ready to wake, not that anything is wrong.
    if let Some(gateway) = app.try_state::<crate::gateway_ws::GatewayClient>() {
        gateway.activate(app.clone());
    }
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
/// That unredirection is real and was measured, after a false start: the black screen
/// that first suggested it turned out to be a fullscreen game on the same monitor. Made
/// properly fullscreen on purpose afterwards, this window went opaque — 11,16,29
/// sampled right across the display, the page's own ground with nothing behind it. So
/// the overlay is monitor-sized and hinted, never fullscreen.
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
///
/// The application's main window, shown, rather than a window of its own. Colai's
/// Settings page *is* `index.html`, which is what the main window loads, so building a
/// second window here produced two identical Settings — one behind the other, each with
/// its own state, and closing the front one revealing a stale copy of the same screen.
///
/// It also keeps the promise the rest of this file makes. "Two windows and no more" is
/// the whole shape of Colai's GUI; a third that happens to look like the second is not
/// a smaller violation of that for being invisible most of the time.
#[tauri::command]
pub(crate) fn colai_open_settings(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "There is no main window to show.".to_string())?;
    let _ = window.show();
    let _ = window.unminimize();
    window
        .set_focus()
        .map_err(|error| format!("Could not show settings: {error}"))
}

/// Which edges of this monitor the desktop's own chrome is using.
///
/// Two sources, because one is not enough.
///
/// **The work area** is the honest, portable one. Every panel that plays by the rules
/// publishes a strut, the window manager folds those into `_NET_WORKAREA`, and GDK hands
/// the result back per monitor. That catches GNOME's top bar, and it catches KDE, XFCE
/// and anything else without Colai knowing they exist.
///
/// **The dock is the exception**, and it is the one that prompted this. Ubuntu's dock
/// runs with `intellihide`, which means it reserves nothing at all — the work area is
/// the full width of the monitor while the dock sits visibly on top of it. Nothing in
/// EWMH describes it. So when the extension is configured, its own settings are asked
/// instead.
///
/// That second source is an approximation and is written down as one: the width comes
/// out as the icon size plus padding, and the padding is Dash to Dock's business, not a
/// published contract. Measured here, 48px icons gave a 66px band. It is close enough
/// that the rail clears the dock, and wrong in the safe direction if the theme changes —
/// a slightly wider reservation costs a few pixels of screen, a narrower one puts the
/// toolbar back underneath.
///
/// The real answer is to measure the obstruction from Colai's own capture of the screen
/// once the screen service exists, and stop asking the desktop about itself.
#[tauri::command]
pub(crate) fn colai_reserved(app: AppHandle) -> Reserved {
    #[cfg(target_os = "linux")]
    {
        let from_work_area = app
            .get_webview_window(OVERLAY_LABEL)
            .and_then(|window| work_area_insets(&window))
            .unwrap_or_default();
        widen_for_dock(from_work_area)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        Reserved::default()
    }
}

#[cfg(target_os = "linux")]
fn work_area_insets(window: &WebviewWindow) -> Option<Reserved> {
    use gtk::prelude::*;

    let gtk_window = window.gtk_window().ok()?;
    let gdk_window = gtk_window.window()?;
    let display = gtk_window.display();
    let monitor = display.monitor_at_window(&gdk_window)?;

    let whole = monitor.geometry();
    let usable = monitor.workarea();

    Some(Reserved {
        top: (usable.y() - whole.y()).max(0),
        left: (usable.x() - whole.x()).max(0),
        right: ((whole.x() + whole.width()) - (usable.x() + usable.width())).max(0),
        bottom: ((whole.y() + whole.height()) - (usable.y() + usable.height())).max(0),
    })
}

/// Add the dock's band on the edge it lives on, when it reserves nothing itself.
#[cfg(target_os = "linux")]
fn widen_for_dock(mut reserved: Reserved) -> Reserved {
    let Some(position) = gsetting("org.gnome.shell.extensions.dash-to-dock", "dock-position")
    else {
        return reserved;
    };
    let icons = gsetting(
        "org.gnome.shell.extensions.dash-to-dock",
        "dash-max-icon-size",
    )
    .and_then(|value| value.trim().parse::<i32>().ok())
    .unwrap_or(48);
    // Padding either side of an icon, measured rather than derived: 48px icons produced
    // a 66px band on this desktop.
    let band = icons + 18;

    let edge = |current: &mut i32| *current = (*current).max(band);
    match position.trim().trim_matches('\'') {
        "LEFT" => edge(&mut reserved.left),
        "RIGHT" => edge(&mut reserved.right),
        "TOP" => edge(&mut reserved.top),
        "BOTTOM" => edge(&mut reserved.bottom),
        _ => {}
    }
    reserved
}

#[cfg(target_os = "linux")]
fn gsetting(schema: &str, key: &str) -> Option<String> {
    let out = std::process::Command::new("gsettings")
        .args(["get", schema, key])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let said = String::from_utf8(out.stdout).ok()?;
    let said = said.trim().to_string();
    if said.is_empty() {
        None
    } else {
        Some(said)
    }
}

/// One agent the toolbar can hand a region to.
///
/// The same list the rest of the application uses, not a second idea of what an agent
/// is. `receiving` is the toolbar's own state on top of it: several agents may be
/// available, and exactly one gets what you point at.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ToolbarAgent {
    pub id: String,
    pub name: String,
    pub emoji: Option<String>,
    pub receiving: bool,
}

/// The agents this machine actually has.
///
/// Read from the Gateway rather than kept here, so the toolbar never disagrees with the
/// window behind it about what is running. The Gateway caches the list itself, so asking
/// on every summon is cheap.
///
/// System agents are left out, the way Quick Chat leaves them out: they are machinery
/// rather than somebody you would hand a region to.
#[tauri::command]
pub(crate) async fn colai_agents(
    gateway: tauri::State<'_, crate::gateway_ws::GatewayClient>,
    receiving: Option<String>,
) -> Result<Vec<ToolbarAgent>, String> {
    let catalog = gateway.agents_list().await?;
    let chosen = receiving.as_deref();
    Ok(catalog
        .agents
        .iter()
        .filter(|summary| summary.kind.as_deref() != Some("system"))
        .map(|summary| {
            let identity = summary.identity.as_ref();
            let name = identity
                .and_then(|identity| identity.name.clone())
                .or_else(|| summary.name.clone())
                .filter(|name| !name.trim().is_empty())
                .unwrap_or_else(|| summary.id.clone());
            ToolbarAgent {
                // Falls back to the Gateway's own default when the toolbar has no pick
                // yet, so the first thing somebody marks still has somewhere to go.
                receiving: match chosen {
                    Some(id) => summary.id == id,
                    None => summary.id == catalog.default_id,
                },
                id: summary.id.clone(),
                name,
                emoji: identity
                    .and_then(|identity| identity.emoji.clone())
                    .filter(|emoji| !emoji.trim().is_empty()),
            }
        })
        .collect())
}

/// One conversation on the toolbar's menu.
///
/// `title` is settled here rather than in the page, because deciding what a nameless
/// session is called is a judgement about the data and not about layout, and the rail
/// and the menu must never disagree about what a row is called.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ToolbarSession {
    pub key: String,
    pub title: String,
    pub agent_id: Option<String>,
    pub busy: bool,
    pub unread: bool,
    pub receiving: bool,
}

/// The conversations this machine is holding.
///
/// The other half of "who receives what you point at": an agent is who could answer,
/// a session is a conversation already underway, and handing a region to one of those
/// puts it where the work already is.
///
/// Nothing is invented when the Gateway has nothing. An empty list is a real answer —
/// no conversations yet — and the page says so rather than filling the menu.
#[tauri::command]
pub(crate) async fn colai_sessions(
    gateway: tauri::State<'_, crate::gateway_ws::GatewayClient>,
    receiving: Option<String>,
) -> Result<Vec<ToolbarSession>, String> {
    let listed = gateway.sessions_list().await?;
    let chosen = receiving.as_deref();
    Ok(listed
        .sessions
        .iter()
        .map(|row| ToolbarSession {
            key: row.key.clone(),
            title: session_title(row),
            agent_id: row.agent_id.clone(),
            // Only a run that has not finished is worth showing: a session that failed
            // an hour ago is simply a session, and a red mark on it would be a warning
            // about nothing.
            busy: matches!(row.status.as_deref(), Some("running") | Some("queued")),
            unread: row.unread.unwrap_or(false),
            receiving: chosen == Some(row.key.as_str()),
        })
        .collect())
}

/// What to call a conversation, in the order a person would.
///
/// The name somebody gave it, then the name the Gateway shows in its own list, then the
/// title projected from the first message, and only then the routing key — which is an
/// address rather than a name, and appears when a session genuinely has nothing else.
fn session_title(row: &crate::gateway_ws::GatewaySessionSummary) -> String {
    [
        row.label.as_deref(),
        row.display_name.as_deref(),
        row.derived_title.as_deref(),
        row.last_message_preview.as_deref(),
    ]
    .into_iter()
    .flatten()
    .map(str::trim)
    .find(|name| !name.is_empty())
    .map(|name| name.to_string())
    .unwrap_or_else(|| row.key.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gateway_ws::GatewaySessionSummary;

    fn row(key: &str) -> GatewaySessionSummary {
        GatewaySessionSummary {
            key: key.to_string(),
            agent_id: None,
            label: None,
            display_name: None,
            derived_title: None,
            last_message_preview: None,
            status: None,
            unread: None,
        }
    }

    #[test]
    fn a_session_is_called_what_a_person_called_it() {
        let mut named = row("agent:main:whatsapp:123");
        named.label = Some("Kitchen rebuild".to_string());
        named.display_name = Some("+1 555".to_string());
        named.derived_title = Some("help me with".to_string());
        assert_eq!(session_title(&named), "Kitchen rebuild");
    }

    #[test]
    fn an_unnamed_session_falls_back_through_what_it_has() {
        let mut projected = row("agent:main:cli:42");
        // A blank label is not a name; skipping it is the difference between a menu of
        // conversations and a menu of empty rows.
        projected.label = Some("   ".to_string());
        projected.derived_title = Some("Rewrite the invoice parser".to_string());
        assert_eq!(session_title(&projected), "Rewrite the invoice parser");

        // Nothing at all leaves the routing key, which is an address rather than a name
        // — shown because a row nobody can identify is worse than an ugly one.
        assert_eq!(
            session_title(&row("agent:main:cli:42")),
            "agent:main:cli:42"
        );
    }
}
