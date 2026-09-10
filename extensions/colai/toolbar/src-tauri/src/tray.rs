// The toolbar's own place in the system tray.
//
// The toolbar can be put away from its own keyboard, and standing alone it has no other
// window — so without this, somebody who pressed Escape had nothing left on screen to
// press and no way back except killing the process and letting OpenClaw start it again.
//
// It ticked a menu item in the OpenClaw desktop app before this program was cut out of
// it. That app is not what installs the toolbar any more; the plugin is, and the plugin
// has no tray. So the toolbar carries its own.

use crate::colai;
use std::sync::Mutex;
use tauri::menu::{CheckMenuItem, MenuBuilder, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{App, AppHandle};

const TOOLBAR_ID: &str = "colai-toolbar";
const OPEN_ID: &str = "open-openclaw";
const QUIT_ID: &str = "quit";

/// The tray, kept alive and reachable so the tick can be corrected.
pub(crate) struct Tray {
    _icon: TrayIcon<tauri::Wry>,
    toolbar: CheckMenuItem<tauri::Wry>,
    /// Whether the last thing anybody was told is still true, so a redundant set is free.
    showing: Mutex<bool>,
}

impl Tray {
    /// Say whether the toolbar is on screen.
    ///
    /// Told by whatever put it there or took it away, rather than worked out when the
    /// menu opens: it can go from the toolbar's own keyboard, and a tray that only
    /// learned about its own clicks would be confidently wrong the first time somebody
    /// pressed Escape.
    pub(crate) fn says_toolbar(&self, showing: bool) {
        let Ok(mut last) = self.showing.lock() else {
            return;
        };
        if *last == showing {
            return;
        }
        *last = showing;
        let _ = self.toolbar.set_checked(showing);
    }
}

/// Put colai in the tray.
pub(crate) fn build(app: &App) -> tauri::Result<Tray> {
    // Ticked on, because the toolbar opens with the program.
    let toolbar = CheckMenuItem::with_id(app, TOOLBAR_ID, "Toolbar", true, true, None::<&str>)?;
    let open = MenuItem::with_id(app, OPEN_ID, "Open OpenClaw", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, QUIT_ID, "Quit colai", true, None::<&str>)?;
    let menu = MenuBuilder::new(app)
        .items(&[&toolbar, &open, &separator, &quit])
        .build()?;

    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?;
    let built = TrayIconBuilder::with_id("colai")
        .icon(icon)
        .menu(&menu)
        // Left click opens the menu. The one-click alternative would be to toggle the
        // toolbar, and a control that changes the screen without saying which way it is
        // about to go is worse than one more click.
        .show_menu_on_left_click(true)
        .on_menu_event(pressed)
        .build(app)?;

    Ok(Tray {
        _icon: built,
        toolbar,
        showing: Mutex::new(true),
    })
}

/// What the menu does.
fn pressed(app: &AppHandle, event: tauri::menu::MenuEvent) {
    match event.id().as_ref() {
        TOOLBAR_ID => {
            // Read from the window rather than from the tick. The tick is what this is
            // about to correct, and asking it what to do would make the two agree with
            // each other while disagreeing with the screen.
            let showing = colai::toolbar_is_showing(app);
            let done = if showing {
                colai::colai_release(app.clone())
            } else {
                colai::colai_summon(app.clone())
            };
            if let Err(trouble) = done {
                eprintln!("[colai] could not turn the toolbar {}: {trouble}", {
                    if showing { "off" } else { "on" }
                });
            }
        }
        OPEN_ID => {
            if let Err(trouble) = colai::colai_open_settings(app.clone()) {
                eprintln!("[colai] {trouble}");
            }
        }
        QUIT_ID => app.exit(0),
        _ => {}
    }
}
