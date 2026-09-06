//! What is actually under the pointer, as the desktop itself describes it.
//!
//! Every other tool hands an agent pixels. A model reads an image well, but it is
//! reading: "a red button near the top" is a guess about something the desktop already
//! knows exactly — that it is a Button, that its name is "Send", that it is disabled,
//! and where its edges are. This asks.
//!
//! Over the D-Bus connection the app already has a client for, rather than the `atspi`
//! crate: the interfaces used here are four methods and three properties on a stable
//! specification, and taking a dependency to spell them differently would mean owning
//! its version alignment with zbus forever.
//!
//! It is honest about its reach. GTK applications answer; Chromium and Electron ones
//! expose nothing unless they believe a screen reader is present, which on a
//! developer's desk is most of the windows. A window that says nothing produces no
//! reading rather than an invented one, and the message says so — an agent told
//! nothing about structure knows it is looking at pixels, where an agent told
//! something vague does not.

use serde::Serialize;
use zbus::zvariant::OwnedObjectPath;
use zbus::{Connection, Proxy};

/// An AT-SPI object: which application answers for it, and where it lives there.
type Node = (String, OwnedObjectPath);

/// What the registry returns when there is nothing at a point.
const NOWHERE: &str = "/org/a11y/atspi/null";
/// Screen coordinates rather than window-relative ones.
const ON_SCREEN: u32 = 0;
/// How far down a tree to walk before deciding it is not converging.
///
/// A well-behaved application answers "what is at this point" with something smaller
/// each time and then with itself. One that keeps handing back a different object is
/// not going to stop, and the toolbar cannot wait for it to.
const DEEPEST: usize = 40;
/// How long a reading taken for a mark's address may take.
///
/// Shorter than a deliberate inspection, because nobody asked for it. Marking is
/// instant today and has to stay that way; an address is worth a quarter of a second
/// and not a whole one.
const BRIEFLY: std::time::Duration = std::time::Duration::from_millis(250);

/// How long the whole reading may take.
///
/// These calls go to another application's main loop. A window that is busy — or
/// wedged — answers slowly or never, and a toolbar that hangs because something else
/// is hung is a worse tool than one that says it could not tell.
const PATIENCE: std::time::Duration = std::time::Duration::from_millis(900);

/// What the desktop says is at a point.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Seen {
    pub role: String,
    pub name: String,
    /// Left, top, width, height, in screen pixels.
    pub at: (i32, i32, i32, i32),
    /// The handful of things it sits inside, nearest first.
    pub within: Vec<String>,
}

/// Read the structure under a point on the overlay.
///
/// The point arrives in the overlay's own coordinates, because that is what the page
/// has; the desktop wants screen coordinates, and the overlay knows where it is.
#[tauri::command]
pub(crate) async fn colai_inspect(
    app: tauri::AppHandle,
    x: i32,
    y: i32,
) -> Result<Option<Seen>, String> {
    #[cfg(target_os = "linux")]
    {
        use tauri::Manager;
        let at = app
            .get_webview_window(crate::colai::OVERLAY_LABEL)
            .ok_or_else(|| "The toolbar is not open.".to_string())?
            .outer_position()
            .map_err(|error| format!("Could not find the overlay: {error}"))?;
        match tokio::time::timeout(PATIENCE, look_at(x + at.x, y + at.y)).await {
            Ok(seen) => seen,
            // Not an error: a window that will not answer in time has told us nothing,
            // which is the same outcome as a window with nothing to tell.
            Err(_) => Ok(None),
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, x, y);
        Ok(None)
    }
}

#[cfg(target_os = "linux")]
async fn look_at(x: i32, y: i32) -> Result<Option<Seen>, String> {
    let bus = accessibility_bus().await?;
    let root: Node = (
        "org.a11y.atspi.Registry".to_string(),
        OwnedObjectPath::try_from("/org/a11y/atspi/accessible/root")
            .map_err(|error| format!("Could not address the desktop: {error}"))?,
    );

    // Applications, then their windows. The desktop object itself does not answer "what
    // is at this point"; only the windows under it do, so the containing one has to be
    // found before anything can be asked.
    let Ok(apps) = children(&bus, &root).await else {
        return Ok(None);
    };
    for app in apps {
        let Ok(windows) = children(&bus, &app).await else {
            continue;
        };
        for window in windows {
            if !contains(&bus, &window, x, y).await {
                continue;
            }
            return Ok(Some(
                describe(&bus, innermost(&bus, window, x, y).await, x, y).await,
            ));
        }
    }
    Ok(None)
}

/// The a11y bus, whose address the session bus is asked for.
/// The address of the page or folder a window is showing, if it will say.
///
/// Asked only where there is an answer worth waiting for. A browser has a URL and a file
/// manager has a folder; an editor, a terminal and a game have nothing here that the
/// window's own process did not already say better, so they are not asked at all and
/// marking in them costs exactly nothing.
///
/// The kind is decided by what the window exposes rather than by a list of brand names:
/// a window with a `Document` in it is showing a document, whatever it is called.
#[tauri::command]
pub(crate) async fn colai_showing(x: i32, y: i32) -> Option<Showing> {
    #[cfg(target_os = "linux")]
    {
        match tokio::time::timeout(BRIEFLY, showing_at(x, y)).await {
            Ok(seen) => seen,
            // A desktop that will not answer in a quarter of a second has told us
            // nothing, which is the same outcome as one with nothing to tell.
            Err(_) => None,
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (x, y);
        None
    }
}

/// What a window says it is showing.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Showing {
    pub url: Option<String>,
}

#[cfg(target_os = "linux")]
async fn showing_at(x: i32, y: i32) -> Option<Showing> {
    let bus = accessibility_bus().await.ok()?;
    let root: Node = (
        "org.a11y.atspi.Registry".to_string(),
        OwnedObjectPath::try_from("/org/a11y/atspi/accessible/root").ok()?,
    );
    for app in children(&bus, &root).await.ok()? {
        for window in children(&bus, &app).await.ok()? {
            if !contains(&bus, &window, x, y).await {
                continue;
            }
            let url = document_url(&bus, &window).await;
            return Some(Showing { url });
        }
    }
    None
}

/// How far into a window to look for the thing that knows its own address.
///
/// A browser puts its document two or three levels below the window. Beyond that is
/// somebody else's document — a frame, an embedded view — and answering with the address
/// of a thing nobody pointed at is worse than answering with nothing.
#[cfg(target_os = "linux")]
const DOCUMENT_WITHIN: usize = 4;

#[cfg(target_os = "linux")]
async fn document_url(bus: &Connection, window: &Node) -> Option<String> {
    let mut looking = vec![(window.clone(), 0usize)];
    while let Some((node, depth)) = looking.pop() {
        if let Some(paper) = on(bus, &node, "org.a11y.atspi.Document").await {
            if let Ok(url) = paper
                .call::<_, _, String>("GetAttributeValue", &("DocURL",))
                .await
            {
                let url = url.trim().to_string();
                // An empty attribute is the interface saying "I have no document",
                // which is not the same as a document at the empty address.
                if !url.is_empty() {
                    return Some(url);
                }
            }
        }
        if depth + 1 >= DOCUMENT_WITHIN {
            continue;
        }
        for child in children(bus, &node).await.unwrap_or_default() {
            looking.push((child, depth + 1));
        }
    }
    None
}

#[cfg(target_os = "linux")]
async fn accessibility_bus() -> Result<Connection, String> {
    let session = Connection::session()
        .await
        .map_err(|error| format!("No session bus: {error}"))?;
    let door = Proxy::new(&session, "org.a11y.Bus", "/org/a11y/bus", "org.a11y.Bus")
        .await
        .map_err(|error| format!("No accessibility bus: {error}"))?;
    let address: String = door
        .call("GetAddress", &())
        .await
        .map_err(|error| format!("The accessibility bus has no address: {error}"))?;
    zbus::connection::Builder::address(address.as_str())
        .map_err(|error| format!("Could not read that address: {error}"))?
        .build()
        .await
        .map_err(|error| format!("Could not reach the accessibility bus: {error}"))
}

#[cfg(target_os = "linux")]
async fn on<'a>(bus: &'a Connection, node: &Node, face: &'static str) -> Option<Proxy<'a>> {
    Proxy::new(bus, node.0.clone(), node.1.clone(), face)
        .await
        .ok()
}

#[cfg(target_os = "linux")]
async fn children(bus: &Connection, node: &Node) -> Result<Vec<Node>, ()> {
    let seat = on(bus, node, "org.a11y.atspi.Accessible").await.ok_or(())?;
    seat.call("GetChildren", &()).await.map_err(|_| ())
}

#[cfg(target_os = "linux")]
async fn contains(bus: &Connection, node: &Node, x: i32, y: i32) -> bool {
    let Some(shape) = on(bus, node, "org.a11y.atspi.Component").await else {
        return false;
    };
    shape
        .call("Contains", &(x, y, ON_SCREEN))
        .await
        .unwrap_or(false)
}

/// The smallest thing at a point, by asking each container what is under it.
#[cfg(target_os = "linux")]
async fn innermost(bus: &Connection, from: Node, x: i32, y: i32) -> Node {
    let mut here = from;
    for _ in 0..DEEPEST {
        let Some(shape) = on(bus, &here, "org.a11y.atspi.Component").await else {
            return here;
        };
        let Ok(under) = shape
            .call::<_, _, Node>("GetAccessibleAtPoint", &(x, y, ON_SCREEN))
            .await
        else {
            return here;
        };
        // Nothing further in, or the same thing again: this is as small as it gets.
        if under.1.as_str() == NOWHERE || under == here {
            return here;
        }
        here = under;
    }
    here
}

#[cfg(target_os = "linux")]
async fn describe(bus: &Connection, node: Node, x: i32, y: i32) -> Seen {
    let role = role_of(bus, &node).await;
    let name = name_of(bus, &node).await;
    let at = extents_of(bus, &node).await.unwrap_or((x, y, 0, 0));

    // A couple of ancestors, because "Button" alone says nothing about which button.
    // Not the whole way to the desktop: past three, the names stop being about the
    // thing that was pointed at.
    let mut within = Vec::new();
    let mut climbing = node;
    for _ in 0..3 {
        let Some(seat) = on(bus, &climbing, "org.a11y.atspi.Accessible").await else {
            break;
        };
        let Ok(parent) = seat.get_property::<Node>("Parent").await else {
            break;
        };
        if parent.1.as_str() == NOWHERE || parent == climbing {
            break;
        }
        let said = name_of(bus, &parent).await;
        let role = role_of(bus, &parent).await;
        within.push(if said.is_empty() {
            role
        } else {
            format!("{role} “{said}”")
        });
        climbing = parent;
    }

    Seen {
        role,
        name,
        at,
        within,
    }
}

#[cfg(target_os = "linux")]
async fn role_of(bus: &Connection, node: &Node) -> String {
    match on(bus, node, "org.a11y.atspi.Accessible").await {
        Some(seat) => seat
            .call::<_, _, String>("GetRoleName", &())
            .await
            .unwrap_or_else(|_| "unknown".to_string()),
        None => "unknown".to_string(),
    }
}

#[cfg(target_os = "linux")]
async fn name_of(bus: &Connection, node: &Node) -> String {
    match on(bus, node, "org.a11y.atspi.Accessible").await {
        Some(seat) => seat
            .get_property::<String>("Name")
            .await
            .unwrap_or_default()
            .trim()
            .to_string(),
        None => String::new(),
    }
}

#[cfg(target_os = "linux")]
async fn extents_of(bus: &Connection, node: &Node) -> Option<(i32, i32, i32, i32)> {
    on(bus, node, "org.a11y.atspi.Component")
        .await?
        .call("GetExtents", &(ON_SCREEN,))
        .await
        .ok()
}
