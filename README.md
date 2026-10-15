# dash-c2pa

C2PA verification of DASH (fragmented MP4) segments inside [dash.js](https://github.com/Dash-Industry-Forum/dash.js), using [c2pa-rs](https://github.com/contentauth/c2pa-rs) compiled to WebAssembly.

## How it works

1. **dash.js hook**: `player.addResponseInterceptor(fn)` runs an async chain on every HTTP response *before* the success callback hands bytes to the SourceBuffer (`src/streaming/net/HTTPLoader.js`, `_applyResponseInterceptors`). The interceptor can therefore hold, inspect, or reject each segment. `response.request.customData.request` carries `type` (`InitializationSegment` / `MediaSegment`), `mediaType`, and `representation`.
2. **c2pa-rs**: `Reader::with_fragment_async(format, init, fragment)` validates one media segment against the manifest in its init segment (BMFF hash). This crate exposes it as `verifySegment(format, init, segment, trustAnchors?)` via wasm-bindgen. `trustAnchors` is an optional PEM bundle of root certificates, set as a `TrustAnchor` on the c2pa `Context` settings; a segment whose signer chains to one of them reports `Trusted` instead of `Valid`.
3. **Glue**: [`examples/interceptor.js`](examples/interceptor.js) caches the init segment per track and verifies each media segment, reporting `{ state, manifest, blocked }` to a callback.

```js
await attachC2paVerifier(player, onResult, {
    policy: 'block',        // or 'annotate' (default)
    trustAnchors: pemText,  // optional
});
```

### Block policy

With `policy: 'block'`, a segment that is `Invalid` (or fails to verify, e.g. no manifest) never reaches the SourceBuffer. The interceptor keeps the 2xx status and replaces the body with an empty `ArrayBuffer`:

- dash.js treats a zero-byte append as a successful no-op (`SourceBufferSink._appendNextInQueue`), schedules the next segment as usual, and `GapController` jumps the hole in the buffer. On the tampered fixture, playback skips video 2–3 s and continues to the end.
- Returning a non-2xx status instead goes down the download-error path. After the retries, `FragmentController` adds the segment's whole BaseURL to the service-location blacklist. With a single BaseURL, the track can no longer build segment URLs and stalls. Throwing from the interceptor leaves the request unresolved.

## Build

```bash
wasm-pack build --target web --release
```

Requires Rust 1.96 (pinned in `rust-toolchain.toml`) and the `wasm32-unknown-unknown` target. c2pa is built with `rust_native_crypto` (no OpenSSL), so it compiles for the browser. `Cargo.toml` passes the wasm feature flags (bulk memory etc.) that wasm-pack's bundled `wasm-opt` needs for modules from current Rust.

## Test

```bash
cargo test                      # native: Reader::with_fragment on the fixtures
scripts/make-fixtures.sh        # regenerate fixtures (needs ffmpeg)
```

`tests/fixtures/` holds an 8 s synthetic clip (320x180 H.264 + AAC, 1 s segments) packaged by ffmpeg as fMP4 DASH:

- `unsigned/`: ffmpeg output, no manifest.
- `signed/`: signed with `Builder::sign_fragmented_files` ([`examples/sign_fixtures.rs`](examples/sign_fixtures.rs)) using the c2pa-rs `es256` test certificate. No timestamp authority, so the fixtures build offline.
- `tampered/`: copy of `signed/` with 16 bytes of the `mdat` in video `0/seg-3.m4s` inverted.
- `certs/test_cert_root_bundle.pem`: c2pa-rs test root CAs (`sdk/tests/fixtures/certs/trust/` at `c2pa-v0.91.2`). With these as trust anchors the signed fixtures report `Trusted`.

## Demo

```bash
wasm-pack build --target web --release
python3 -m http.server 8765
```

Open <http://localhost:8765/demo/>. [`demo/index.html`](demo/index.html) plays the fixtures with dash.js and lists the result for every segment. Links (or `?stream=signed|tampered&policy=annotate|block&trust=none|test`) select the stream, policy and trust anchors.

- Signed, no trust anchors: every segment reports `Valid` with `signingCredential.untrusted`. That code alone leaves the state at `Valid`.
- Signed, `trust=test`: every segment reports `Trusted`.
- Tampered, `policy=annotate`: video `seg-3` reports `Invalid` with `assertion.bmffHash.mismatch` and is still buffered. dash.js then hits `MEDIA_ERR_DECODE`, keeps resetting the MediaSource and refetching segments, and playback never starts.
- Tampered, `policy=block`: video `seg-3` is `Invalid` and blocked. No player errors; playback skips the 1 s hole and reaches the end.

### Manifest panels

Above the table, the demo shows one [`c2pa-react-component`](https://www.npmjs.com/package/c2pa-react-component) `<C2paManifest>` panel per track (video, audio). React 19, `@xyflow/react` 12 and `c2pa-react-component@0.1.22` load from esm.sh through an import map, so there is still no build step. If the CDN fails, the table keeps working.

- [`demo/to-verification-outcome.js`](demo/to-verification-outcome.js) converts a `verifySegment` result (c2pa-rs `Reader::json()`) into the component's `VerificationOutcome`:
  - snake_case manifest keys become camelCase.
  - Assertions become a record keyed by label.
  - `state` becomes a boolean.
  - The per-segment Merkle hash lists in `c2pa.hash.bmff.v3` are replaced by a count.
  - `Trusted` maps to `validation_state: 'Valid'`, because the component only knows `Valid` / `Invalid` / `Unknown`. The panel heading still shows `Trusted`.
- [`demo/manifest-panels.js`](demo/manifest-panels.js) renders the panels. Each panel shows the latest segment's result. Once a segment is not valid, the panel holds on it, because dash.js fetches segments in bursts and the next result would replace it within milliseconds. A strip of segment buttons selects any earlier result, and "Follow latest" releases the hold. On the tampered stream, the video panel shows the `Invalid` badge and `assertion.bmffHash.mismatch` at `seg-3`.
- The detail level defaults to 4. In 0.1.22, only levels 3 and 4 show the validation state. Level 1 exposes it only in its `aria-label`, and level 2 never shows the invalid card, because `C2paManifest` does not pass `officialList` through.

## Findings (dash.js 5.2.x, c2pa 0.91.2, Oct 2026)

- No formal plugin registry in dash.js; extension points are `extend()`, request/response interceptors, custom ABR rules, DRM filters, capability filters, and events. Response interceptors are the right fit.
- **Low-latency gap**: in low-latency chunked mode (Fetch API), chunks are appended via `LOADING_DATA_PROGRESS` in `FragmentLoader.js` and bypass the interceptor. Verifying there needs low latency disabled or a `player.extend()` override of the fragment loader.
- **Live manifests**: c2pa-rs only defines the `emsg` box type; it does not appear to support the C2PA live-streaming model (per-segment manifests in `emsg`). VOD content with the manifest in the init segment is the supported case.
- **npm**: dash.js 5.2.2 is not on npm (latest is 5.2.1), so the demo loads 5.2.1 from jsDelivr. The interceptor code path is the same.
- **End-of-stream refetch**: intermittently (with either policy, including the signed stream), dash.js 5.2.1 keeps seeking to the stream end after `PLAYBACK_ENDED` and refetches the last audio segment every ~200 ms (`PlaybackController._onPlaybackEnded`, "native video element didn't fire ended"). The audio track ends ~20 ms before video. Not yet seen without the interceptor; cause not isolated.
- **Size**: the release `.wasm` is ~6.9 MB before `wasm-opt` and ~5.9 MB after `-Oz`. Load it in a Web Worker to keep verification off the main thread.

## Status

Verified end to end on signed VOD fixtures: native tests pass, and in the browser with dash.js 5.2.1 the wasm build reports per-segment results, blocks the tampered segment without player errors, and reports `Trusted` with the c2pa-rs test root.

- [x] Signed fMP4 test fixtures (`Builder::sign_fragmented_files`, `scripts/make-fixtures.sh`)
- [x] Native tests: valid, tampered, unsigned, and trusted segments (`tests/verify.rs`)
- [x] Browser test with dash.js (`demo/index.html`)
- [x] Per-track manifest panels with `c2pa-react-component` (`demo/manifest-panels.js`)
- [ ] Web Worker wrapper
- [x] Policy option: block vs. annotate unverified segments (`policy: 'block'`)
- [x] Trust anchors option for `verifySegment` (`Trusted` state)

## License

[MIT](LICENSE).

The test signing certificates in `tests/fixtures/certs/` come from [c2pa-rs](https://github.com/contentauth/c2pa-rs) (MIT OR Apache-2.0). They are for testing only.
