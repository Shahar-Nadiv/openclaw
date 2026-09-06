//! Files and folders brought into a send from the machine the toolbar is running on.
//!
//! The toolbar's own marks are pictures it took. This is the other half: the thing
//! somebody already has — a log, a stylesheet, a directory of them — dropped onto the
//! composer or chosen from a file dialog.
//!
//! Two jobs, and deliberately no store between them. What a mark photographed exists
//! only in memory and has to be held; a file on disk is already stored, by the file
//! system, better than this could. So a path is described when it arrives and read when
//! it is sent, and a file edited in between is sent as it is now — which is the answer
//! somebody would expect from a toolbar that shows them a path.

use base64::Engine as _;
use serde::Serialize;

use crate::gateway_ws::ChatAttachment;

/// A path somebody brought in, as the composer needs to show it.
///
/// `bytes` is the whole tree for a folder, so the composer can say how big the thing
/// somebody dropped actually is rather than reporting a directory as 4 KB.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Chosen {
    pub path: String,
    pub name: String,
    pub bytes: u64,
    pub folder: bool,
}

/// How deep a dropped folder is measured, and how many entries are counted.
///
/// Only its size is wanted, and only to decide whether to say "12 MB" or "1.2 GB" next
/// to it. Walking a home directory to four decimal places would freeze the toolbar for
/// a number nobody reads that closely, so the walk stops and the size is a floor.
const DEEPEST: usize = 6;
const MOST_ENTRIES: usize = 20_000;

/// Describe paths that arrived by drag and drop.
#[tauri::command]
pub(crate) fn colai_describe_files(paths: Vec<String>) -> Vec<Chosen> {
    paths
        .iter()
        .filter_map(|path| describe(path.as_ref()))
        .collect()
}

/// Ask for files, or for a folder, through the desktop's own file dialog.
///
/// GTK's, on the main thread, because that is the loop the rest of this window lives
/// on and a chooser opened off it is a dialog the window manager cannot place. The
/// answer comes back over a channel rather than being returned from the closure, since
/// what `run_on_main_thread` gives back is only whether the closure was scheduled.
#[tauri::command]
pub(crate) async fn colai_pick_files(
    app: tauri::AppHandle,
    folders: bool,
) -> Result<Vec<Chosen>, String> {
    #[cfg(target_os = "linux")]
    {
        use tauri::Manager as _;
        let (say, heard) = tokio::sync::oneshot::channel::<Vec<String>>();
        let parent = app.get_webview_window(crate::colai::OVERLAY_LABEL);
        app.run_on_main_thread(move || {
            let _ = say.send(ask_gtk(parent, folders));
        })
        .map_err(|error| format!("Could not open the file chooser: {error}"))?;
        let picked = heard
            .await
            .map_err(|_| "The file chooser closed without answering.".to_string())?;
        Ok(picked
            .iter()
            .filter_map(|path| describe(path.as_ref()))
            .collect())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, folders);
        Err("Choosing files is only wired up on Linux.".to_string())
    }
}

/// The dialog itself. Runs a nested main loop, which is what makes it modal.
#[cfg(target_os = "linux")]
fn ask_gtk(parent: Option<tauri::WebviewWindow>, folders: bool) -> Vec<String> {
    use gtk::prelude::*;

    let window = parent.and_then(|window| window.gtk_window().ok());
    let chooser = gtk::FileChooserNative::new(
        if folders {
            Some("Add a folder")
        } else {
            Some("Add files")
        },
        window.as_ref(),
        if folders {
            gtk::FileChooserAction::SelectFolder
        } else {
            gtk::FileChooserAction::Open
        },
        Some("Add"),
        Some("Cancel"),
    );
    chooser.set_select_multiple(true);
    let answered = chooser.run();
    let picked = if answered == gtk::ResponseType::Accept {
        chooser
            .filenames()
            .iter()
            .filter_map(|path| path.to_str().map(str::to_string))
            .collect()
    } else {
        Vec::new()
    };
    // Native choosers are not destroyed by running them, and one left alive keeps a
    // reference to the toolbar window it was parented to.
    chooser.destroy();
    picked
}

fn describe(path: &std::path::Path) -> Option<Chosen> {
    let facts = std::fs::metadata(path).ok()?;
    let folder = facts.is_dir();
    Some(Chosen {
        path: path.to_str()?.to_string(),
        name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("(unnamed)")
            .to_string(),
        bytes: if folder { weigh(path) } else { facts.len() },
        folder,
    })
}

/// How much a folder holds, to the depth worth walking.
#[cfg(unix)]
fn weigh(root: &std::path::Path) -> u64 {
    let mut total = 0u64;
    let mut seen = 0usize;
    let mut walking = vec![(root.to_path_buf(), 0usize)];
    while let Some((here, depth)) = walking.pop() {
        let Ok(entries) = std::fs::read_dir(&here) else {
            continue;
        };
        for entry in entries.flatten() {
            if seen >= MOST_ENTRIES {
                return total;
            }
            seen += 1;
            // `symlink_metadata`, so a link into a parent directory is counted as the
            // few bytes it is rather than walked into a loop.
            let Ok(facts) = entry.metadata() else {
                continue;
            };
            if facts.is_dir() {
                if depth + 1 < DEEPEST {
                    walking.push((entry.path(), depth + 1));
                }
            } else {
                total = total.saturating_add(facts.len());
            }
        }
    }
    total
}

#[cfg(not(unix))]
fn weigh(_root: &std::path::Path) -> u64 {
    0
}

/// Read the files that are travelling with a message.
///
/// Only the ones the page decided could travel — the size rules live next to the
/// composer that shows them, and are tested there. A path that has gone since it was
/// dropped is skipped rather than failing the send: the message still names it, and
/// losing a whole send because one of four files moved is the worse outcome.
pub(crate) fn carry(paths: &[String]) -> Vec<ChatAttachment> {
    paths
        .iter()
        .filter_map(|path| {
            let path = std::path::Path::new(path);
            let bytes = std::fs::read(path).ok()?;
            Some(ChatAttachment {
                kind: "file".to_string(),
                mime_type: mime_of(path).to_string(),
                file_name: path.file_name()?.to_str()?.to_string(),
                content: base64::engine::general_purpose::STANDARD.encode(bytes),
                // Not a picture, so it has no size on screen. The Gateway sniffs the
                // real type off the bytes anyway; these are a hint, not a claim.
                width: 0,
                height: 0,
            })
        })
        .collect()
}

/// A guess at the type, from the extension.
///
/// Deliberately shallow. The Gateway sniffs the actual bytes and warns when the two
/// disagree, so the only job here is to be a useful hint for the handful of things
/// somebody actually drags onto a toolbar — and to say "unknown" honestly otherwise
/// rather than guessing text and having something binary arrive mangled.
fn mime_of(path: &std::path::Path) -> &'static str {
    match path
        .extension()
        .and_then(|end| end.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("pdf") => "application/pdf",
        Some("json") => "application/json",
        Some("md") => "text/markdown",
        Some("csv") => "text/csv",
        Some("html" | "htm") => "text/html",
        Some("css") => "text/css",
        Some(
            "txt" | "log" | "ts" | "tsx" | "js" | "jsx" | "rs" | "py" | "sh" | "toml" | "yml"
            | "yaml",
        ) => "text/plain",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_folder_weighs_what_is_in_it_not_what_the_directory_entry_says() {
        let root = std::env::temp_dir().join(format!("colai-weigh-{}", std::process::id()));
        let inner = root.join("deeper");
        std::fs::create_dir_all(&inner).unwrap();
        std::fs::write(root.join("a.txt"), vec![0u8; 100]).unwrap();
        std::fs::write(inner.join("b.txt"), vec![0u8; 250]).unwrap();

        let seen = describe(&root).unwrap();
        assert!(seen.folder);
        assert_eq!(seen.bytes, 350);
        assert_eq!(seen.name, root.file_name().unwrap().to_str().unwrap());

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_path_that_is_not_there_is_left_out_rather_than_described_as_empty() {
        assert!(describe(std::path::Path::new("/nowhere/at/all/really")).is_none());
        assert!(carry(&["/nowhere/at/all/really".to_string()]).is_empty());
    }

    #[test]
    fn a_file_travels_under_its_own_name_with_a_type_worth_having() {
        let path = std::env::temp_dir().join(format!("colai-carry-{}.md", std::process::id()));
        std::fs::write(&path, b"# hello").unwrap();

        let carried = carry(&[path.to_str().unwrap().to_string()]);
        assert_eq!(carried.len(), 1);
        assert_eq!(
            carried[0].file_name,
            path.file_name().unwrap().to_str().unwrap()
        );
        assert_eq!(carried[0].mime_type, "text/markdown");
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(&carried[0].content)
                .unwrap(),
            b"# hello"
        );

        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn an_unfamiliar_extension_says_so_rather_than_guessing_text() {
        assert_eq!(
            mime_of(std::path::Path::new("a.wasm")),
            "application/octet-stream"
        );
        assert_eq!(
            mime_of(std::path::Path::new("a")),
            "application/octet-stream"
        );
        assert_eq!(mime_of(std::path::Path::new("A.PNG")), "image/png");
    }
}
