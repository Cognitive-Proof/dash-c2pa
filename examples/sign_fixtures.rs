//! Signs unsigned fMP4 DASH content with c2pa-rs, for test fixtures.
//! Driven by `scripts/make-fixtures.sh`.
//!
//! ```bash
//! cargo run --example sign_fixtures -- <unsigned_dir> <signed_dir>
//! cargo run --example sign_fixtures -- --tamper <segment.m4s>
//! ```
//!
//! `<unsigned_dir>` holds one sub-directory per representation, each with an
//! `init.mp4` and `seg-*.m4s` media segments. They are written to the same
//! layout under `<signed_dir>`.

use std::path::{Path, PathBuf};

use anyhow::{bail, Context as _, Result};
use c2pa::{create_signer, Builder, Context, SigningAlg};
use serde_json::json;

const CERT: &[u8] = include_bytes!("../tests/fixtures/certs/es256.pub");
const KEY: &[u8] = include_bytes!("../tests/fixtures/certs/es256.pem");

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.as_slice() {
        [flag, segment] if flag == "--tamper" => tamper(Path::new(segment)),
        [src, dst] => sign(Path::new(src), Path::new(dst)),
        _ => bail!("usage: sign_fixtures <unsigned_dir> <signed_dir> | --tamper <segment.m4s>"),
    }
}

fn sign(src: &Path, dst: &Path) -> Result<()> {
    std::fs::create_dir_all(dst)?;

    let definition = json!({
        "title": "dash-c2pa test stream",
        "claim_generator_info": [{ "name": "dash-c2pa sign_fixtures", "version": env!("CARGO_PKG_VERSION") }],
        "assertions": [{
            "label": "c2pa.actions",
            "data": { "actions": [{
                "action": "c2pa.created",
                "digitalSourceType": "http://cv.iptc.org/newscodes/digitalsourcetype/algorithmicMedia"
            }]}
        }]
    });
    let mut builder =
        Builder::from_context(Context::new()).with_definition(definition.to_string())?;
    // No TSA: fixtures must be reproducible offline.
    let signer = create_signer::from_keys(CERT, KEY, SigningAlg::Es256, None)?;

    let init_glob: PathBuf = src.join("*").join("init.mp4");
    builder
        .sign_fragmented_files(
            signer.as_ref(),
            init_glob,
            PathBuf::from("seg-*.m4s"),
            dst.to_path_buf(),
        )
        .context("sign_fragmented_files")?;
    Ok(())
}

/// Flip bytes in the middle of the segment's `mdat` payload.
fn tamper(segment: &Path) -> Result<()> {
    let mut bytes = std::fs::read(segment)?;
    let mdat = find_box(&bytes, b"mdat").context("no mdat box")?;
    let mid = mdat.start + (mdat.end - mdat.start) / 2;
    for b in &mut bytes[mid..mid + 16] {
        *b ^= 0xff;
    }
    std::fs::write(segment, bytes)?;
    Ok(())
}

/// Payload range of the first top-level box of type `kind`.
fn find_box(data: &[u8], kind: &[u8; 4]) -> Option<std::ops::Range<usize>> {
    let mut pos = 0;
    while pos + 8 <= data.len() {
        let size = u32::from_be_bytes(data[pos..pos + 4].try_into().ok()?) as usize;
        let (header, size) = match size {
            1 => (
                16,
                u64::from_be_bytes(data[pos + 8..pos + 16].try_into().ok()?) as usize,
            ),
            0 => (8, data.len() - pos),
            n => (8, n),
        };
        if size < header || pos + size > data.len() {
            return None;
        }
        if &data[pos + 4..pos + 8] == kind {
            return Some(pos + header..pos + size);
        }
        pos += size;
    }
    None
}
