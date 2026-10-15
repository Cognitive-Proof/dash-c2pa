// dash.js response interceptor that verifies each fMP4 media segment with C2PA.
//
// Build the wasm package first:  wasm-pack build --target web --release
// Not yet tested against signed content; see README "Status".

import init, { verifySegment } from '../pkg/dash_c2pa.js';

const INIT_SEGMENT = 'InitializationSegment';
const MEDIA_SEGMENT = 'MediaSegment';

/**
 * @param {dashjs.MediaPlayerClass} player
 * @param {(result: {key: string, url: string, state?: string, manifest?: object, error?: string}) => void} onResult
 */
export async function attachC2paVerifier(player, onResult) {
    await init();

    // Init segment bytes per track (mediaType + representation id).
    const initSegments = new Map();

    player.addResponseInterceptor(async (response) => {
        const req = response.request?.customData?.request;
        if (!req || !(response.data instanceof ArrayBuffer)) {
            return response;
        }

        const key = `${req.mediaType}:${req.representation?.id}`;
        const bytes = new Uint8Array(response.data);

        if (req.type === INIT_SEGMENT) {
            initSegments.set(key, bytes);
        } else if (req.type === MEDIA_SEGMENT) {
            const initBytes = initSegments.get(key);
            if (initBytes) {
                const format = req.mediaType === 'audio' ? 'audio/mp4' : 'video/mp4';
                try {
                    const { state, manifest } = await verifySegment(format, initBytes, bytes);
                    onResult({ key, url: response.url, state, manifest: JSON.parse(manifest) });
                } catch (e) {
                    onResult({ key, url: response.url, error: String(e) });
                }
            }
        }

        // Returning the response lets dash.js buffer it. To block unverified
        // segments, throw or return a non-2xx status here instead.
        return response;
    });
}
