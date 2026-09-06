//! Turning a mark into a picture somebody can look at.
//!
//! The toolbar's whole promise is that you point at something and an agent sees what you
//! meant. A region drawn on glass is not that: it is a rectangle in fractions of a
//! screen, and it means nothing to anyone who was not looking at the screen. This is
//! where it becomes pixels.
//!
//! Two decisions shape everything here.
//!
//! **The mark is drawn back on.** A box or a circle survives being cropped — the crop is
//! the annotation. A pin has no size at all and a freehand stroke is a shape rather than
//! an area, so cropping either one produces a picture of some pixels with no indication
//! of what about them mattered. Those take the ground around them and wear the mark.
//!
//! **The bytes stay here.** A screenshot is a megabyte and the page has no use for it: it
//! shows a thumbnail and knows the mark's name. Sending the full image to the page and
//! back again would put that megabyte through the IPC boundary twice for nothing.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// A point on the overlay, in fractions of it.
#[derive(Debug, Clone, Copy, Deserialize)]
pub(crate) struct Spot {
    pub x: f64,
    pub y: f64,
}

/// A rectangle on the overlay, in fractions of it.
#[derive(Debug, Clone, Copy, Deserialize)]
pub(crate) struct Frame {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct Region {
    pub shape: String,
    /// `box` is the page's name for it and a keyword here.
    #[serde(rename = "box")]
    pub frame: Frame,
}

/// One thing somebody marked, exactly as the page holds it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Mark {
    pub id: String,
    pub tool: String,
    #[serde(default)]
    pub region: Option<Region>,
    #[serde(default)]
    pub points: Vec<Spot>,
}

/// A rectangle of the display, in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Crop {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// Room left around a region so the outline drawn on it is not clipped by its own edge.
const OUTLINE_ROOM: f64 = 12.0;
/// How much of the screen a point or a stroke takes with it, as a share of the short side.
const CONTEXT_SHARE: f64 = 0.14;
/// The least context worth taking, whatever the display is.
const CONTEXT_LEAST: f64 = 140.0;
/// The widest edge a thumbnail is allowed, which is all the page needs to show a row.
const THUMB_EDGE: i32 = 180;
/// The widest edge a picture keeps before it is shrunk.
///
/// Bounded here rather than at the send, because the Gateway refuses an image over 6MB
/// and a refusal at that point loses the whole batch for one oversized capture. A
/// whole-display PNG is comfortably under this once scaled, and no agent reads a
/// screenshot at native resolution anyway.
const SHOT_EDGE: i32 = 1600;

/// The pixels a mark is about.
///
/// A box or a circle is its own answer. A pin and a stroke are not — a pin has no area
/// whatsoever — so those take the ground around them, because a crop of nothing tells an
/// agent nothing. A mark with neither is a whole-display capture, which is what the
/// screenshot tool asks for when it is clicked rather than dragged.
///
/// Everything is clamped to the display: a mark made against an edge still has to name a
/// rectangle that exists.
pub(crate) fn crop_for(mark: &Mark, width: i32, height: i32) -> Option<Crop> {
    if width <= 0 || height <= 0 {
        return None;
    }
    let (w, h) = (f64::from(width), f64::from(height));
    let Some((left, top, right, bottom)) = edges_of(mark) else {
        return Some(Crop {
            x: 0,
            y: 0,
            width,
            height,
        });
    };
    let room = if mark.region.is_some() {
        OUTLINE_ROOM
    } else {
        (w.min(h) * CONTEXT_SHARE).max(CONTEXT_LEAST)
    };
    let x = (left * w - room).max(0.0);
    let y = (top * h - room).max(0.0);
    let far_x = (right * w + room).min(w);
    let far_y = (bottom * h + room).min(h);
    // A region dragged entirely off the edge leaves nothing to photograph. Saying so is
    // better than handing GDK a zero-width rectangle and reading its complaint.
    if far_x - x < 1.0 || far_y - y < 1.0 {
        return None;
    }
    Some(Crop {
        x: x as i32,
        y: y as i32,
        width: (far_x - x) as i32,
        height: (far_y - y) as i32,
    })
}

/// A mark's extent in fractions: left, top, right, bottom.
fn edges_of(mark: &Mark) -> Option<(f64, f64, f64, f64)> {
    if let Some(region) = &mark.region {
        let frame = region.frame;
        return Some((frame.x, frame.y, frame.x + frame.w, frame.y + frame.h));
    }
    let first = mark.points.first()?;
    let mut edges = (first.x, first.y, first.x, first.y);
    for spot in &mark.points {
        edges.0 = edges.0.min(spot.x);
        edges.1 = edges.1.min(spot.y);
        edges.2 = edges.2.max(spot.x);
        edges.3 = edges.3.max(spot.y);
    }
    Some(edges)
}

/// A mark's own points, moved into the crop taken for it.
///
/// The page thinks in fractions of the whole overlay and the picture is a corner of it,
/// so nothing can be drawn until the two agree. Kept separate from the drawing so the
/// arithmetic can be tested without a display.
pub(crate) fn points_within(mark: &Mark, crop: Crop, width: i32, height: i32) -> Vec<(f64, f64)> {
    let (w, h) = (f64::from(width), f64::from(height));
    let (ox, oy) = (f64::from(crop.x), f64::from(crop.y));
    match &mark.region {
        Some(region) => {
            let frame = region.frame;
            vec![
                (frame.x * w - ox, frame.y * h - oy),
                ((frame.x + frame.w) * w - ox, (frame.y + frame.h) * h - oy),
            ]
        }
        None => mark
            .points
            .iter()
            .map(|spot| (spot.x * w - ox, spot.y * h - oy))
            .collect(),
    }
}

/// What to draw over a picture so it says what was meant by it.
///
/// The screenshot tools mark nothing: the crop is the whole statement, and an outline
/// around the edge of a picture is noise.
pub(crate) fn drawn_as(mark: &Mark) -> Option<&'static str> {
    if matches!(mark.tool.as_str(), "screenshot" | "wireframe") {
        return None;
    }
    match mark.region.as_ref().map(|region| region.shape.as_str()) {
        Some("ellipse") => Some("ellipse"),
        Some(_) => Some("box"),
        None if mark.points.len() > 1 => Some("stroke"),
        None => Some("pin"),
    }
}

/// A picture taken for a mark, waiting to be sent.
pub(crate) struct Shot {
    pub id: String,
    pub png: Vec<u8>,
    pub width: i32,
    pub height: i32,
}

/// The pictures taken for marks nobody has sent yet.
///
/// Bounded on both counts that can run away: how many are held, and how much they weigh
/// together. An afternoon of marking should not become the reason the machine swaps.
#[derive(Default)]
pub(crate) struct MarkShots(Mutex<Vec<Shot>>);

/// How many pictures are held before the oldest is dropped.
const SHOTS_KEPT: usize = 40;
/// And how much they may weigh together, whichever runs out first.
const SHOTS_WEIGH: usize = 48 * 1024 * 1024;

impl MarkShots {
    pub(crate) fn keep(&self, shot: Shot) -> Result<(), String> {
        let mut held = self.held()?;
        held.retain(|kept| kept.id != shot.id);
        held.push(shot);
        while held.len() > SHOTS_KEPT
            || (held.len() > 1
                && held.iter().map(|shot| shot.png.len()).sum::<usize>() > SHOTS_WEIGH)
        {
            held.remove(0);
        }
        Ok(())
    }

    /// The pictures for these marks, in the order asked for, skipping any already gone.
    pub(crate) fn pick(&self, ids: &[String]) -> Result<Vec<(String, Vec<u8>, i32, i32)>, String> {
        let held = self.held()?;
        Ok(ids
            .iter()
            .filter_map(|id| held.iter().find(|shot| &shot.id == id))
            .map(|shot| (shot.id.clone(), shot.png.clone(), shot.width, shot.height))
            .collect())
    }

    pub(crate) fn forget(&self, ids: &[String]) -> Result<(), String> {
        self.held()?.retain(|shot| !ids.contains(&shot.id));
        Ok(())
    }

    fn held(&self) -> Result<std::sync::MutexGuard<'_, Vec<Shot>>, String> {
        self.0
            .lock()
            .map_err(|_| "The pictures taken for your marks are unavailable.".to_string())
    }
}

/// What the page learns about a picture: enough to show it, never the picture itself.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Taken {
    pub id: String,
    /// A small PNG as a data URL, sized for a row in a list.
    pub thumb: String,
    pub width: i32,
    pub height: i32,
}

/// Photograph what a mark is about.
///
/// The page makes itself invisible before calling this and visible again after, which is
/// why nothing here touches the window: hiding an always-on-top window and showing it
/// again asks the window manager for a favour, and it usually answers by taking the
/// keyboard away from whatever somebody was typing into. A transparent window composites
/// to nothing, so the picture comes out clean without the overlay ever changing state.
#[tauri::command]
pub(crate) async fn colai_capture_mark(
    app: AppHandle,
    mark: Mark,
    accent: Option<String>,
) -> Result<Taken, String> {
    let window = app
        .get_webview_window(crate::colai::OVERLAY_LABEL)
        .ok_or_else(|| "The toolbar is not open.".to_string())?;
    let size = window
        .inner_size()
        .map_err(|error| format!("Could not measure the overlay: {error}"))?;
    let at = window
        .outer_position()
        .map_err(|error| format!("Could not find the overlay: {error}"))?;
    let width = size.width as i32;
    let height = size.height as i32;
    let crop = crop_for(&mark, width, height)
        .ok_or_else(|| "There is nothing inside that mark to photograph.".to_string())?;
    let within = points_within(&mark, crop, width, height);
    let drawn = drawn_as(&mark).map(str::to_string);
    let accent = accent.unwrap_or_else(|| "#ff6b6b".to_string());

    // GDK belongs to the main thread. The page has already made itself invisible and is
    // waiting on this, so the hop is the only thing between the two.
    let (done, wait) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = done.send(picture_of(
            (crop.x + at.x, crop.y + at.y, crop.width, crop.height),
            &within,
            drawn.as_deref(),
            &accent,
        ));
    })
    .map_err(|error| format!("Could not reach the display: {error}"))?;
    let png = wait
        .recv()
        .map_err(|_| "The display did not answer.".to_string())??;

    let thumb = thumbnail(&png)?;
    app.state::<MarkShots>().keep(Shot {
        id: mark.id.clone(),
        png,
        width: crop.width,
        height: crop.height,
    })?;
    Ok(Taken {
        id: mark.id,
        thumb,
        width: crop.width,
        height: crop.height,
    })
}

/// Forget the pictures for marks that were undone or have been sent.
#[tauri::command]
pub(crate) fn colai_forget_marks(
    shots: tauri::State<'_, MarkShots>,
    ids: Vec<String>,
) -> Result<(), String> {
    shots.forget(&ids)
}

#[cfg(target_os = "linux")]
fn picture_of(
    at: (i32, i32, i32, i32),
    within: &[(f64, f64)],
    drawn: Option<&str>,
    accent: &str,
) -> Result<Vec<u8>, String> {
    use gdk::cairo;
    use gdk::prelude::*;

    let (x, y, width, height) = at;
    let root = gdk::Screen::default()
        .and_then(|screen| screen.root_window())
        .ok_or_else(|| "There is no display to photograph.".to_string())?;
    let taken = root
        .pixbuf(x, y, width, height)
        .ok_or_else(|| "The display would not give up that region.".to_string())?;

    let Some(drawn) = drawn else {
        return encode(&shrunk(&taken)?);
    };

    let surface = cairo::ImageSurface::create(cairo::Format::Rgb24, width, height)
        .map_err(|error| format!("Could not prepare the picture: {error}"))?;
    let ink = cairo::Context::new(&surface)
        .map_err(|error| format!("Could not draw on the picture: {error}"))?;
    ink.set_source_pixbuf(&taken, 0.0, 0.0);
    ink.paint()
        .map_err(|error| format!("Could not copy the region: {error}"))?;
    draw_mark(&ink, drawn, within, accent)?;
    drop(ink);

    let marked = gdk::pixbuf_get_from_surface(&surface, 0, 0, width, height)
        .ok_or_else(|| "Could not read the marked picture back.".to_string())?;
    encode(&shrunk(&marked)?)
}

/// Put the mark on the picture, twice.
///
/// A single stroke in one colour disappears against whatever it happens to land on — a
/// red circle over a red button is not an annotation. The dark pass underneath is what
/// makes the bright one legible on any background, which is the same trick the rail uses
/// to sit over an unknown desktop.
#[cfg(target_os = "linux")]
fn draw_mark(
    ink: &gdk::cairo::Context,
    drawn: &str,
    within: &[(f64, f64)],
    accent: &str,
) -> Result<(), String> {
    let (red, green, blue) = colour_of(accent);
    let trace = |ink: &gdk::cairo::Context| match drawn {
        "box" => {
            let [(left, top), (right, bottom)] = [within[0], within[1]];
            ink.rectangle(left, top, right - left, bottom - top);
        }
        "ellipse" => {
            let [(left, top), (right, bottom)] = [within[0], within[1]];
            let (rx, ry) = ((right - left) / 2.0, (bottom - top) / 2.0);
            ink.save().ok();
            ink.translate(left + rx, top + ry);
            ink.scale(rx.max(0.5), ry.max(0.5));
            ink.arc(0.0, 0.0, 1.0, 0.0, std::f64::consts::TAU);
            ink.restore().ok();
        }
        "pin" => {
            let (x, y) = within[0];
            ink.arc(x, y, 13.0, 0.0, std::f64::consts::TAU);
        }
        _ => {
            for (at, (x, y)) in within.iter().enumerate() {
                if at == 0 {
                    ink.move_to(*x, *y);
                } else {
                    ink.line_to(*x, *y);
                }
            }
        }
    };

    ink.set_line_cap(gdk::cairo::LineCap::Round);
    ink.set_line_join(gdk::cairo::LineJoin::Round);
    ink.set_source_rgba(0.0, 0.0, 0.0, 0.45);
    ink.set_line_width(7.0);
    trace(ink);
    ink.stroke()
        .map_err(|error| format!("Could not outline the mark: {error}"))?;
    ink.set_source_rgb(red, green, blue);
    ink.set_line_width(3.5);
    trace(ink);
    ink.stroke()
        .map_err(|error| format!("Could not draw the mark: {error}"))?;
    Ok(())
}

/// `#rrggbb` as cairo takes it, falling back to the toolbar's own red.
fn colour_of(accent: &str) -> (f64, f64, f64) {
    let digits = accent.trim().trim_start_matches('#');
    if digits.len() == 6 {
        if let Ok(packed) = u32::from_str_radix(digits, 16) {
            return (
                f64::from((packed >> 16) & 0xff) / 255.0,
                f64::from((packed >> 8) & 0xff) / 255.0,
                f64::from(packed & 0xff) / 255.0,
            );
        }
    }
    (1.0, 0.42, 0.42)
}

#[cfg(target_os = "linux")]
fn encode(pixbuf: &gdk::gdk_pixbuf::Pixbuf) -> Result<Vec<u8>, String> {
    pixbuf
        .save_to_bufferv("png", &[])
        .map_err(|error| format!("Could not encode the picture: {error}"))
}

/// A picture brought under the size an agent will accept, or left alone if it already is.
#[cfg(target_os = "linux")]
fn shrunk(pixbuf: &gdk::gdk_pixbuf::Pixbuf) -> Result<gdk::gdk_pixbuf::Pixbuf, String> {
    let (width, height) = (pixbuf.width().max(1), pixbuf.height().max(1));
    let longest = width.max(height);
    if longest <= SHOT_EDGE {
        return Ok(pixbuf.clone());
    }
    let scale = f64::from(SHOT_EDGE) / f64::from(longest);
    pixbuf
        .scale_simple(
            ((f64::from(width) * scale) as i32).max(1),
            ((f64::from(height) * scale) as i32).max(1),
            gdk::gdk_pixbuf::InterpType::Bilinear,
        )
        .ok_or_else(|| "Could not shrink the picture to a size an agent will take.".to_string())
}

/// A small copy of a picture, as a data URL the page can put straight in an `img`.
#[cfg(target_os = "linux")]
fn thumbnail(png: &[u8]) -> Result<String, String> {
    use base64::Engine as _;
    use gdk::gdk_pixbuf::{InterpType, Pixbuf, PixbufLoader};
    use gdk::prelude::PixbufLoaderExt;

    let loader = PixbufLoader::new();
    loader
        .write(png)
        .map_err(|error| format!("Could not read the picture back: {error}"))?;
    loader
        .close()
        .map_err(|error| format!("Could not finish reading the picture: {error}"))?;
    let full: Pixbuf = loader
        .pixbuf()
        .ok_or_else(|| "The picture came back empty.".to_string())?;
    let (width, height) = (full.width().max(1), full.height().max(1));
    let scale = f64::from(THUMB_EDGE) / f64::from(width.max(height));
    let small = if scale < 1.0 {
        full.scale_simple(
            ((f64::from(width) * scale) as i32).max(1),
            ((f64::from(height) * scale) as i32).max(1),
            InterpType::Bilinear,
        )
        .ok_or_else(|| "Could not shrink the picture.".to_string())?
    } else {
        full
    };
    let bytes = encode(&small)?;
    Ok(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

#[cfg(not(target_os = "linux"))]
fn picture_of(
    _at: (i32, i32, i32, i32),
    _within: &[(f64, f64)],
    _drawn: Option<&str>,
    _accent: &str,
) -> Result<Vec<u8>, String> {
    Err("Marking the screen is only built for Linux so far.".to_string())
}

#[cfg(not(target_os = "linux"))]
fn thumbnail(_png: &[u8]) -> Result<String, String> {
    Err("Marking the screen is only built for Linux so far.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mark(tool: &str, region: Option<Region>, points: Vec<Spot>) -> Mark {
        Mark {
            id: "m1".to_string(),
            tool: tool.to_string(),
            region,
            points,
        }
    }

    fn boxed(x: f64, y: f64, w: f64, h: f64) -> Option<Region> {
        Some(Region {
            shape: "box".to_string(),
            frame: Frame { x, y, w, h },
        })
    }

    #[test]
    fn a_region_is_photographed_with_room_for_its_own_outline() {
        let crop = crop_for(
            &mark("box", boxed(0.25, 0.5, 0.25, 0.25), vec![]),
            1000,
            800,
        )
        .unwrap();
        // 250..500 across and 400..600 down, widened by the room the outline needs.
        assert_eq!(
            crop,
            Crop {
                x: 238,
                y: 388,
                width: 274,
                height: 224
            }
        );
    }

    #[test]
    fn a_pin_takes_the_ground_around_it() {
        // A point has no area, so a crop of the point alone is a picture of one pixel.
        let crop = crop_for(
            &mark("pointAt", None, vec![Spot { x: 0.5, y: 0.5 }]),
            1000,
            800,
        )
        .unwrap();
        assert_eq!(crop.width, 280);
        assert_eq!(crop.height, 280);
        assert_eq!((crop.x, crop.y), (360, 260));
    }

    #[test]
    fn a_mark_against_an_edge_still_names_a_rectangle_that_exists() {
        let crop = crop_for(
            &mark("pointAt", None, vec![Spot { x: 0.0, y: 0.0 }]),
            1000,
            800,
        )
        .unwrap();
        assert_eq!((crop.x, crop.y), (0, 0));
        assert!(crop.width > 0 && crop.height > 0);
        // Dragged clean off the display there is nothing to photograph, and saying so
        // beats handing GDK a rectangle of no width.
        assert!(crop_for(&mark("box", boxed(1.5, 1.5, 0.1, 0.1), vec![]), 1000, 800).is_none());
        assert!(crop_for(&mark("box", boxed(0.1, 0.1, 0.1, 0.1), vec![]), 0, 0).is_none());
    }

    #[test]
    fn a_mark_with_nothing_in_it_photographs_the_whole_display() {
        let crop = crop_for(&mark("screenshot", None, vec![]), 1920, 1080).unwrap();
        assert_eq!(
            crop,
            Crop {
                x: 0,
                y: 0,
                width: 1920,
                height: 1080
            }
        );
    }

    #[test]
    fn points_move_into_the_picture_taken_for_them() {
        let one = mark("pointAt", None, vec![Spot { x: 0.5, y: 0.5 }]);
        let crop = crop_for(&one, 1000, 800).unwrap();
        let within = points_within(&one, crop, 1000, 800);
        // The pin was at 500,400 on the display and the crop starts at 360,260.
        assert_eq!(within, vec![(140.0, 140.0)]);
    }

    #[test]
    fn only_the_tools_that_mean_something_are_drawn_on() {
        assert_eq!(
            drawn_as(&mark("box", boxed(0.1, 0.1, 0.2, 0.2), vec![])),
            Some("box")
        );
        assert_eq!(
            drawn_as(&mark(
                "circle",
                Some(Region {
                    shape: "ellipse".to_string(),
                    frame: Frame {
                        x: 0.1,
                        y: 0.1,
                        w: 0.2,
                        h: 0.2
                    },
                }),
                vec![]
            )),
            Some("ellipse"),
        );
        assert_eq!(
            drawn_as(&mark("pointAt", None, vec![Spot { x: 0.5, y: 0.5 }])),
            Some("pin")
        );
        assert_eq!(
            drawn_as(&mark(
                "draw",
                None,
                vec![Spot { x: 0.1, y: 0.1 }, Spot { x: 0.2, y: 0.2 }]
            )),
            Some("stroke"),
        );
        // A screenshot is the whole statement; an outline round its edge is noise.
        assert_eq!(drawn_as(&mark("screenshot", None, vec![])), None);
        assert_eq!(
            drawn_as(&mark("wireframe", boxed(0.1, 0.1, 0.2, 0.2), vec![])),
            None
        );
    }

    #[test]
    fn the_store_drops_the_oldest_rather_than_growing_forever() {
        let shots = MarkShots::default();
        for at in 0..SHOTS_KEPT + 5 {
            shots
                .keep(Shot {
                    id: format!("m{at}"),
                    png: vec![0; 16],
                    width: 10,
                    height: 10,
                })
                .unwrap();
        }
        let held = shots.0.lock().unwrap();
        assert_eq!(held.len(), SHOTS_KEPT);
        assert_eq!(held[0].id, "m5");
    }

    #[test]
    fn keeping_a_mark_twice_replaces_its_picture_rather_than_doubling_it() {
        let shots = MarkShots::default();
        for _ in 0..2 {
            shots
                .keep(Shot {
                    id: "m1".to_string(),
                    png: vec![7; 4],
                    width: 1,
                    height: 1,
                })
                .unwrap();
        }
        assert_eq!(shots.0.lock().unwrap().len(), 1);
        assert_eq!(shots.pick(&["m1".to_string()]).unwrap().len(), 1);
        shots.forget(&["m1".to_string()]).unwrap();
        assert!(shots.pick(&["m1".to_string()]).unwrap().is_empty());
    }

    #[test]
    fn an_accent_that_makes_no_sense_falls_back_to_the_toolbars_own() {
        assert_eq!(colour_of("#000000"), (0.0, 0.0, 0.0));
        assert_eq!(colour_of("ffffff"), (1.0, 1.0, 1.0));
        for nonsense in ["", "#12", "#gggggg", "rebeccapurple"] {
            assert_eq!(colour_of(nonsense), (1.0, 0.42, 0.42));
        }
    }
}
