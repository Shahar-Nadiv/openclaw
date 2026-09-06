//! Handing what was marked to whoever is receiving it.
//!
//! The toolbar offers three kinds of receiver — an agent, a conversation the Gateway is
//! holding, and a conversation held in another agent entirely — and they look like three
//! different things on the menu. They are not three different sends. Every one of them
//! resolves to a session key, and from there a message with pictures attached goes out
//! the same way for all of them.
//!
//! The message itself is composed in the page, not here. What an agent reads is a
//! product decision that belongs next to the marks somebody made, and it is a pure
//! function there with tests on it. This module's job is to resolve a receiver, attach
//! the pictures, and say what happened.

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::colai_capture::MarkShots;
use crate::gateway_ws::{
    ChatAttachment, ChatRoutingTarget, CronAdd, CronAdded, GatewayClient, StartHere, ThreadLocator,
};

/// Who is getting this, as the page knows them.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Receiver {
    /// `agent`, `session`, or `thread`.
    pub kind: String,
    pub id: String,
    /// Only a thread has one, and a thread cannot be reached without it.
    #[serde(default)]
    pub locator: Option<ThreadLocator>,
}

/// What the receipt gets to say.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Sent {
    pub session_key: String,
    pub run_id: String,
    /// How many pictures actually went. A mark whose picture has aged out of the store
    /// is still described in the message; it just arrives without its picture, and the
    /// receipt should not claim otherwise.
    pub pictures: usize,
    /// How many of the files somebody brought in actually went with it.
    pub carried: usize,
    /// Whether the reply will find its way back to the screen.
    ///
    /// Said rather than swallowed. A subscription that quietly failed leaves a mark
    /// waiting on an answer that is never coming, which looks exactly like an agent
    /// thinking about it — the worst of both, since the answer did arrive, just
    /// somewhere else.
    pub watching: bool,
}

/// Send the marked work to whoever was chosen.
#[tauri::command]
pub(crate) async fn colai_send(
    gateway: State<'_, GatewayClient>,
    shots: State<'_, MarkShots>,
    receiver: Receiver,
    message: String,
    mark_ids: Vec<String>,
    files: Vec<String>,
) -> Result<Sent, String> {
    let message = message.trim().to_string();
    if message.is_empty() {
        return Err("There is nothing to send.".to_string());
    }
    let target = resolve(&gateway, &receiver).await?;
    let mut attachments = attach(&shots, &mark_ids)?;
    let pictures = attachments.len();
    // After the pictures, in the order the message describes them. The message has
    // already decided which of these travel and which are only named; anything in this
    // list is one that travels.
    attachments.extend(crate::colai_files::carry(&files));
    let carried = attachments.len() - pictures;
    let sent = gateway
        .chat_send_to(
            target,
            message,
            attachments,
            // Every send is its own send. The key exists so a transport retry cannot
            // double-post, not to collapse two deliberate sends of the same marks.
            &uuid::Uuid::new_v4().to_string(),
        )
        .await?;
    // Only once it has landed. A failed send that had already forgotten its pictures
    // would leave the marks in the tray with nothing behind them.
    shots.forget(&mark_ids)?;
    // Listening is not worth failing the send over — the message has already landed,
    // and all that is lost is the answer coming back to the screen rather than to the
    // conversation. Worth saying, though, which is what `watching` is for.
    let watching = gateway
        .watch_session(&sent.target.session_key, true)
        .await
        .is_ok();
    Ok(Sent {
        session_key: sent.target.session_key,
        run_id: sent.run_id,
        pictures,
        carried,
        watching,
    })
}

/// Which session a receiver turns out to be.
///
/// A thread is the only one that costs anything: continuing it is what makes a
/// conversation held elsewhere into one the Gateway can speak to, and it is a real
/// handover. The page asks before it ever gets here.
async fn resolve(
    gateway: &GatewayClient,
    receiver: &Receiver,
) -> Result<ChatRoutingTarget, String> {
    match receiver.kind.as_str() {
        "agent" => gateway.target_for_agent(&receiver.id).await,
        "session" => Ok(ChatRoutingTarget {
            session_key: receiver.id.clone(),
            // A canonical session key already says whose it is; naming the agent again
            // is rejected.
            agent_id: None,
        }),
        "thread" => {
            let locator = receiver
                .locator
                .clone()
                .ok_or_else(|| "That conversation cannot be reached from here.".to_string())?;
            let session_key = gateway.catalog_continue(locator).await?;
            Ok(ChatRoutingTarget {
                session_key,
                agent_id: None,
            })
        }
        other => Err(format!("There is no way to send to a {other}.")),
    }
}

/// The pictures for these marks, named in the order the message describes them.
///
/// The names matter: the message says "mark 2" and the agent has to be able to tell
/// which picture that is. A mark that photographed once keeps the plain name it always
/// had; a recording numbers its frames after it, so a set of six is a sequence rather
/// than six unrelated pictures of the same corner of a screen.
fn attach(shots: &MarkShots, mark_ids: &[String]) -> Result<Vec<ChatAttachment>, String> {
    let mut carried = Vec::new();
    for (at, (_, frames, width, height)) in shots.pick(mark_ids)?.into_iter().enumerate() {
        let many = frames.len() > 1;
        for (frame, png) in frames.into_iter().enumerate() {
            carried.push(ChatAttachment {
                kind: "image".to_string(),
                mime_type: "image/png".to_string(),
                file_name: if many {
                    format!("mark-{}-{}.png", at + 1, frame + 1)
                } else {
                    format!("mark-{}.png", at + 1)
                },
                content: base64::engine::general_purpose::STANDARD.encode(png),
                width,
                height,
            });
        }
    }
    Ok(carried)
}

/// Make an automation out of what was marked.
///
/// The same request, on a schedule, and the schedule is the Gateway's own — a job made
/// here is a job the Control UI can list, edit and stop, rather than a second idea of
/// what a recurring task is.
///
/// It carries words and no pictures, which is not a shortcut: a scheduled job takes a
/// message and nothing else. The page composes the message knowing that, and says so
/// where somebody can read it before agreeing to it.
#[tauri::command]
pub(crate) async fn colai_automate(
    gateway: State<'_, GatewayClient>,
    receiver: Receiver,
    asked: CronAdd,
) -> Result<CronAdded, String> {
    if asked.name.trim().is_empty() {
        return Err("An automation needs a name.".to_string());
    }
    // Resolved the same way a send is, so "who receives this" means one thing on this
    // surface. A thread is the only kind that costs anything, and the page has already
    // asked before it gets here.
    let target = resolve(&gateway, &receiver).await?;
    // Where the job belongs, said the way the receiver said it. An agent names an
    // agent; a conversation names its session and lets the Gateway work out whose it
    // is. Left off entirely, the job would run against whatever default the Gateway
    // picks — quietly somewhere other than where it was set up.
    gateway
        .cron_add(CronAdd {
            agent_id: target.agent_id.clone(),
            session_key: target.agent_id.is_none().then_some(target.session_key),
            ..asked
        })
        .await
}

/// Stop listening to a conversation.
///
/// Called when the overlay is put away and when what was being waited on is dismissed.
/// A subscription the Gateway is holding for a window that has gone is a socket kept
/// open for nobody.
#[tauri::command]
pub(crate) async fn colai_unwatch(
    gateway: State<'_, GatewayClient>,
    session_key: String,
) -> Result<(), String> {
    gateway.watch_session(&session_key, false).await
}

/// Open a new conversation where the work is.
///
/// Seeded with what was marked, so the first thing the new session sees is the reason
/// it exists rather than an empty prompt somebody then has to explain themselves into.
#[tauri::command]
pub(crate) async fn colai_start_here(
    gateway: State<'_, GatewayClient>,
    asked: StartHere,
) -> Result<(), String> {
    gateway.start_here(asked).await
}
