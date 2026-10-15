//! Native checks of `Reader::with_fragment` on the fixtures written by
//! `scripts/make-fixtures.sh`. The wasm `verifySegment` wraps the async
//! variant of the same call, with a [`dash_c2pa::context`].

use std::fs::File;
use std::path::{Path, PathBuf};

use c2pa::{Reader, ValidationState};

/// (representation dir, MIME type, media segment count)
const TRACKS: &[(&str, &str, usize)] = &[("0", "video/mp4", 8), ("1", "audio/mp4", 9)];

fn fixture(parts: &[&str]) -> PathBuf {
    parts.iter().fold(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures"),
        |p, s| p.join(s),
    )
}

/// c2pa-rs `sdk/tests/fixtures/certs/trust/test_cert_root_bundle.pem`, which
/// includes the root of the es256 test signing cert.
fn test_roots() -> String {
    std::fs::read_to_string(fixture(&["certs", "test_cert_root_bundle.pem"])).unwrap()
}

fn read_segment_with(
    trust_anchors: Option<&str>,
    set: &str,
    rep: &str,
    format: &str,
    n: usize,
) -> c2pa::Result<Reader> {
    let init = File::open(fixture(&[set, rep, "init.mp4"]))?;
    let segment = File::open(fixture(&[set, rep, &format!("seg-{n}.m4s")]))?;
    Reader::from_context(dash_c2pa::context(trust_anchors)?).with_fragment(format, init, segment)
}

fn read_segment(set: &str, rep: &str, format: &str, n: usize) -> c2pa::Result<Reader> {
    read_segment_with(None, set, rep, format, n)
}

fn codes(reader: &Reader) -> Vec<&str> {
    reader
        .validation_status()
        .unwrap_or_default()
        .iter()
        .map(|s| s.code())
        .collect()
}

#[test]
fn signed_segments_validate() {
    for &(rep, format, count) in TRACKS {
        for n in 1..=count {
            let reader = read_segment("signed", rep, format, n)
                .unwrap_or_else(|e| panic!("{rep}/seg-{n}: {e}"));
            let state = reader.validation_state();
            assert_eq!(
                state,
                ValidationState::Valid,
                "{rep}/seg-{n}: {:?}",
                codes(&reader)
            );
            assert!(codes(&reader).contains(&"signingCredential.untrusted"));
            assert!(reader.active_manifest().is_some());
        }
    }
}

#[test]
fn tampered_segment_fails() {
    let reader = read_segment("tampered", "0", "video/mp4", 3).expect("manifest still readable");
    assert_eq!(reader.validation_state(), ValidationState::Invalid);

    let codes = codes(&reader);
    assert!(
        codes.iter().any(|c| c.starts_with("assertion.bmffHash")),
        "unexpected codes: {codes:?}"
    );
}

#[test]
fn untampered_segments_in_tampered_set_still_validate() {
    // Each segment is validated independently against the init segment.
    let reader = read_segment("tampered", "0", "video/mp4", 2).unwrap();
    assert_ne!(reader.validation_state(), ValidationState::Invalid);
}

#[test]
fn unsigned_segment_has_no_manifest() {
    assert!(read_segment("unsigned", "0", "video/mp4", 1).is_err());
}

#[test]
fn signed_segments_trusted_with_test_root() {
    let roots = test_roots();
    for &(rep, format, count) in TRACKS {
        for n in 1..=count {
            let reader = read_segment_with(Some(&roots), "signed", rep, format, n)
                .unwrap_or_else(|e| panic!("{rep}/seg-{n}: {e}"));
            assert_eq!(
                reader.validation_state(),
                ValidationState::Trusted,
                "{rep}/seg-{n}: {:?}",
                codes(&reader)
            );
            assert!(!codes(&reader).contains(&"signingCredential.untrusted"));
        }
    }
}

#[test]
fn tampered_segment_fails_even_when_trusted() {
    let reader = read_segment_with(Some(&test_roots()), "tampered", "0", "video/mp4", 3).unwrap();
    assert_eq!(reader.validation_state(), ValidationState::Invalid);
}
