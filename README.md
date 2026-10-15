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

Requires Rust 1.96 (pinned in `rust-toolchain.toml`) and the `wasm32-unknown-unknown` target. c2pa is built with `rust_native_crypto` (no OpenSSL), so it compiles for the browser.

## Findings (dash.js 5.2.2, c2pa 0.91.2, Oct 2026)

- No formal plugin registry in dash.js; extension points are `extend()`, request/response interceptors, custom ABR rules, DRM filters, capability filters, and events. Response interceptors are the right fit.
- **Low-latency gap**: in low-latency chunked mode (Fetch API), chunks are appended via `LOADING_DATA_PROGRESS` in `FragmentLoader.js` and bypass the interceptor. Verifying there needs low latency disabled or a `player.extend()` override of the fragment loader.
- **Live manifests**: c2pa-rs only defines the `emsg` box type; it does not appear to support the C2PA live-streaming model (per-segment manifests in `emsg`). VOD content with the manifest in the init segment is the supported case.
- **Size**: the release `.wasm` is ~6.9 MB before `wasm-opt`. Load it in a Web Worker to keep verification off the main thread.

## Status

Compiles to `wasm32-unknown-unknown`. **Not yet tested against C2PA-signed DASH content.** Next steps:

- [ ] Signed fMP4 test fixtures (e.g. `Builder::sign_fragmented_files`)
- [ ] Browser test with dash.js
- [ ] Web Worker wrapper
- [ ] Policy option: block vs. annotate unverified segments
