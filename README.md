# dash-c2pa

C2PA verification of DASH (fragmented MP4) segments inside [dash.js](https://github.com/Dash-Industry-Forum/dash.js), using [c2pa-rs](https://github.com/contentauth/c2pa-rs) compiled to WebAssembly.

## How it works

1. **dash.js hook**: `player.addResponseInterceptor(fn)` runs an async chain on every HTTP response *before* the success callback hands bytes to the SourceBuffer (`src/streaming/net/HTTPLoader.js`, `_applyResponseInterceptors`). The interceptor can therefore hold, inspect, or reject each segment. `response.request.customData.request` carries `type` (`InitializationSegment` / `MediaSegment`), `mediaType`, and `representation`.
2. **c2pa-rs**: `Reader::from_fragment_async(format, init, fragment)` validates one media segment against the manifest in its init segment (BMFF hash). This crate exposes it as `verifySegment(format, init, segment)` via wasm-bindgen.
3. **Glue**: [`examples/interceptor.js`](examples/interceptor.js) caches the init segment per track and verifies each media segment, reporting `{ state, manifest }` to a callback.

## Build

```bash
wasm-pack build --target web --release
```

Requires Rust 1.96 (pinned in `rust-toolchain.toml`) and the `wasm32-unknown-unknown` target. c2pa is built with `rust_native_crypto` (no OpenSSL), so it compiles for the browser. `Cargo.toml` passes the wasm feature flags (bulk memory etc.) that wasm-pack's bundled `wasm-opt` needs for modules from current Rust.

## Test

```bash
cargo test                      # native: Reader::from_fragment on the fixtures
scripts/make-fixtures.sh        # regenerate fixtures (needs ffmpeg)
```

`tests/fixtures/` holds an 8 s synthetic clip (320x180 H.264 + AAC, 1 s segments) packaged by ffmpeg as fMP4 DASH:

- `unsigned/`: ffmpeg output, no manifest.
- `signed/`: signed with `Builder::sign_fragmented_files` ([`examples/sign_fixtures.rs`](examples/sign_fixtures.rs)) using the c2pa-rs `es256` test certificate. No timestamp authority, so the fixtures build offline.
- `tampered/`: copy of `signed/` with 16 bytes of the `mdat` in video `0/seg-3.m4s` inverted.

## Demo

```bash
wasm-pack build --target web --release
python3 -m http.server 8765
```

Open <http://localhost:8765/demo/>. [`demo/index.html`](demo/index.html) plays the fixtures with dash.js and lists the result for every segment. On the signed stream every segment reports `Valid`. On the tampered stream video `seg-3` reports `Invalid` with `assertion.bmffHash.mismatch`, and the other segments still report `Valid`. The test cert is not on a trust list, so each result also carries `signingCredential.untrusted`. That code alone leaves the state at `Valid`. Pass trust anchors to get `Trusted`.

The interceptor only annotates segments. The corrupted segment still reaches the SourceBuffer, and dash.js then hits `MEDIA_ERR_DECODE` and keeps resetting the MediaSource.

## Findings (dash.js 5.2.x, c2pa 0.91.2, Oct 2026)

- No formal plugin registry in dash.js; extension points are `extend()`, request/response interceptors, custom ABR rules, DRM filters, capability filters, and events. Response interceptors are the right fit.
- **Low-latency gap**: in low-latency chunked mode (Fetch API), chunks are appended via `LOADING_DATA_PROGRESS` in `FragmentLoader.js` and bypass the interceptor. Verifying there needs low latency disabled or a `player.extend()` override of the fragment loader.
- **Live manifests**: c2pa-rs only defines the `emsg` box type; it does not appear to support the C2PA live-streaming model (per-segment manifests in `emsg`). VOD content with the manifest in the init segment is the supported case.
- **npm**: dash.js 5.2.2 is not on npm (latest is 5.2.1), so the demo loads 5.2.1 from jsDelivr. The interceptor code path is the same.
- **Size**: the release `.wasm` is ~6.9 MB before `wasm-opt` and ~5.9 MB after `-Oz`. Load it in a Web Worker to keep verification off the main thread.

## Status

Verified end to end on signed VOD fixtures: native tests pass, and in the browser with dash.js 5.2.1 the wasm build reports per-segment results, including the tampered segment.

- [x] Signed fMP4 test fixtures (`Builder::sign_fragmented_files`, `scripts/make-fixtures.sh`)
- [x] Native tests: valid, tampered, and unsigned segments (`tests/verify.rs`)
- [x] Browser test with dash.js (`demo/index.html`)
- [ ] Web Worker wrapper
- [ ] Policy option: block vs. annotate unverified segments (today a tampered segment is buffered and causes a decode-error loop)
- [ ] Trust anchors option for `verifySegment` (`Trusted` state)
