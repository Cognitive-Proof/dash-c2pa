// dash.js response interceptor that verifies each fMP4 media segment with C2PA.
//
// Build the wasm package first:  wasm-pack build --target web --release
// Tested with dash.js 5.2.1 in demo/index.html.

import init, { verifySegment } from '../pkg/dash_c2pa.js';

const INIT_SEGMENT = 'InitializationSegment';
const MEDIA_SEGMENT = 'MediaSegment';

/**
 * @typedef {object} C2paResult
 * @property {string} key       `${mediaType}:${representationId}`
 * @property {string} url
 * @property {string} [state]   `Invalid`, `Valid` or `Trusted`
 * @property {object} [manifest] manifest store JSON, including `validation_status`
 * @property {string} [error]   verification threw (e.g. no manifest)
 * @property {boolean} blocked  the segment was withheld from the SourceBuffer
 */

/**
 * @param {dashjs.MediaPlayerClass} player
 * @param {(result: C2paResult) => void} onResult
 * @param {object} [options]
 * @param {'annotate'|'block'} [options.policy='annotate']
 *   `annotate` buffers every segment and only reports. `block` drops the bytes
 *   of segments whose state is `Invalid` (or that fail to verify), so they
 *   never reach the SourceBuffer and playback skips over them.
 * @param {string} [options.trustAnchors] PEM root certificates. Segments
 *   signed under one of them report `Trusted` instead of `Valid`.
 */
export async function attachC2paVerifier(player, onResult, { policy = 'annotate', trustAnchors } = {}) {
    await init();
    const block = policy === 'block';

    // Init segment bytes per track (mediaType + representation id).
    const initSegments = new Map();

    player.addResponseInterceptor(async (response) => {
        const req = response.request?.customData?.request;
        // Aborted requests also pass through interceptors, with partial data.
        const ok = response.status >= 200 && response.status <= 299;
        if (!req || !ok || !(response.data instanceof ArrayBuffer)) {
            return response;
        }

        const key = `${req.mediaType}:${req.representation?.id}`;
        const bytes = new Uint8Array(response.data);

        if (req.type === INIT_SEGMENT) {
            initSegments.set(key, bytes);
            return response;
        }
        if (req.type !== MEDIA_SEGMENT) {
            return response;
        }
        const initBytes = initSegments.get(key);
        if (!initBytes) {
            return response;
        }

        const format = req.mediaType === 'audio' ? 'audio/mp4' : 'video/mp4';
        let result;
        try {
            const { state, manifest } = await verifySegment(format, initBytes, bytes, trustAnchors);
            result = { key, url: response.url, state, manifest: JSON.parse(manifest) };
        } catch (e) {
            result = { key, url: response.url, error: String(e) };
        }
        result.blocked = block && (result.error !== undefined || result.state === 'Invalid');
        onResult(result);

        if (result.blocked) {
            // Keep the 2xx status and hand dash.js an empty body. A non-2xx
            // status would send it down the download-error path, which
            // blacklists the whole BaseURL and stalls the track. A zero-byte
            // append is a no-op success, so dash.js moves on to the next
            // segment and its GapController jumps the hole in the buffer.
            response.data = new ArrayBuffer(0);
        }
        return response;
    });
}
