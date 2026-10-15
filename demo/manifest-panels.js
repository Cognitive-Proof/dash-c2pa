// One <C2paManifest> panel per track, showing the C2PA result of that track's
// latest segment (or a segment picked from the strip below the panel).
// React, @xyflow/react and c2pa-react-component come from esm.sh through the
// import map in index.html, so there is no build step.

import { createElement as h, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { C2paManifest } from 'c2pa-react-component';
import { toVerificationOutcome } from './to-verification-outcome.js';

const segmentName = (url) => url.split('/').pop().replace(/\.m4s$/, '');
const isOk = (r) => r.state === 'Valid' || r.state === 'Trusted';

/**
 * @param {HTMLElement} container
 * @returns {(result: import('../examples/interceptor.js').C2paResult) => void}
 *   call with every interceptor result
 */
export function mountManifestPanels(container) {
    // key -> results in arrival order
    let tracks = new Map();
    const listeners = new Set();
    const store = {
        subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
        get: () => tracks,
    };
    createRoot(container).render(h(Panels, { store }));

    return (result) => {
        if (result.manifest) result.outcome = toVerificationOutcome(result);
        tracks = new Map(tracks);
        tracks.set(result.key, [...(tracks.get(result.key) ?? []), result]);
        for (const fn of listeners) fn();
    };
}

function Panels({ store }) {
    const tracks = useSyncExternalStore(store.subscribe, store.get);
    // Level 4 by default: in c2pa-react-component 0.1.22 only levels 3 and 4
    // show the validation state (level 1 only in its aria-label, level 2 not at all).
    const [level, setLevel] = useState(4);
    if (tracks.size === 0) return h('p', null, 'Waiting for the first segment…');
    const keys = [...tracks.keys()].sort();
    return h('div', null,
        h('label', { className: 'level' }, 'Detail level ',
            h('select', { value: level, onChange: (e) => setLevel(Number(e.target.value)) },
                [1, 2, 3, 4].map((n) => h('option', { key: n, value: n }, n)))),
        // Levels 3 and 4 are wide (graph + detail), so stack the panels.
        h('div', { className: level >= 3 ? 'panels wide' : 'panels' },
            keys.map((key) => h(TrackPanel, { key, trackKey: key, results: tracks.get(key), level }))));
}

function TrackPanel({ trackKey, results, level }) {
    // 'auto': latest result, but the first non-valid one sticks once it
    // arrives (dash.js fetches segments in bursts, so it would otherwise be
    // replaced within milliseconds). 'latest': always the latest result.
    // A number: an index into results, picked from the strip.
    const [mode, setMode] = useState('auto');
    const firstBad = results.findIndex((r) => !isOk(r));
    const index = typeof mode === 'number' ? mode
        : mode === 'auto' && firstBad >= 0 ? firstBad
        : results.length - 1;
    const result = results[index];
    const invalid = results.filter((r) => !isOk(r)).length;
    const follow = (e) => { e.preventDefault(); setMode('latest'); };

    return h('section', { className: 'panel', 'data-track': trackKey, 'data-state': result.state ?? 'Error' },
        h('h3', null, trackKey, ' ',
            h('span', { className: 'seg' }, segmentName(result.url), ' · ', result.state ?? 'Error',
                result.blocked ? ' · blocked' : '')),
        result.outcome
            // The component is styled for a light page.
            ? h('div', { className: 'c2pa-host' },
                h(C2paManifest, { manifest: result.outcome, level, defaultViewMore: true }))
            : h('p', { className: 'error' }, result.error),
        h('p', { className: 'strip-label' },
            `${results.length} results, ${invalid} not valid. `,
            index === results.length - 1 && typeof mode !== 'number'
                ? 'Following the latest segment.'
                : h('span', null,
                    mode === 'auto' ? 'Holding the first segment that is not valid. ' : '',
                    h('a', { href: '#', onClick: follow }, 'Follow latest'))),
        h('div', { className: 'strip' }, results.map((r, i) =>
            h('button', {
                key: i,
                className: [isOk(r) ? 'ok' : 'bad', i === index ? 'current' : ''].join(' '),
                title: `${segmentName(r.url)}: ${r.state ?? r.error}`,
                onClick: () => setMode(i),
            }, segmentName(r.url).replace('seg-', '')))));
}
