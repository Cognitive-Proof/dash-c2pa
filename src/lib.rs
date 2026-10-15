//! Browser-side C2PA verification of fragmented MP4 segments.
//!
//! The C2PA manifest lives in the init segment; each media segment is
//! validated against it with [`c2pa::Reader::from_fragment_async`].

use std::io::Cursor;

use serde::Serialize;
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
struct SegmentResult {
    /// `Invalid`, `Valid` or `Trusted`.
    state: String,
    /// Full manifest store JSON, including `validation_status`.
    manifest: String,
}

/// Validate one media segment against its init segment.
///
/// `format` is the MIME type, e.g. `video/mp4`.
#[wasm_bindgen(js_name = verifySegment)]
pub async fn verify_segment(
    format: String,
    init: Vec<u8>,
    segment: Vec<u8>,
) -> Result<JsValue, JsError> {
    let reader =
        c2pa::Reader::from_fragment_async(&format, Cursor::new(init), Cursor::new(segment))
            .await
            .map_err(|e| JsError::new(&e.to_string()))?;

    let result = SegmentResult {
        state: format!("{:?}", reader.validation_state()),
        manifest: reader.json(),
    };
    Ok(serde_wasm_bindgen::to_value(&result)?)
}
