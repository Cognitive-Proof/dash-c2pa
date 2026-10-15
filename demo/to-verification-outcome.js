// Converts a verifySegment result into the VerificationOutcome shape that
// c2pa-react-component's <C2paManifest> expects.
//
// verifySegment returns c2pa-rs `Reader::json()` (snake_case keys, assertions
// as [{ label, data }]). The component wants camelCase manifest entries,
// assertions keyed by label, and a boolean `state`.

/**
 * @param {{ state: string, manifest: object }} result `state` is
 *   `Invalid`, `Valid` or `Trusted`; `manifest` is the parsed store JSON.
 * @returns {import('c2pa-react-component-types').VerificationOutcome}
 */
export function toVerificationOutcome({ state, manifest: store }) {
    const ok = state === 'Valid' || state === 'Trusted';
    const entries = {};
    for (const [label, m] of Object.entries(store.manifests ?? {})) {
        entries[label] = toManifestEntry(label, m);
    }
    return {
        state: ok,
        manifests: Object.values(entries).map((e) => ({
            id: e.label,
            title: e.title ?? '',
            claimGenerator: e.claimGenerator ?? null,
            claimGeneratorInfo: e.claimGeneratorInfo ?? [],
            instanceId: e.instanceId ?? '',
            signatureInfo: e.signatureInfo ?? {},
            assertions: e.assertions,
            credentials: [],
            thumbnail: null,
            ingredients: e.ingredients,
        })),
        manifestStore: {
            activeManifest: store.active_manifest ?? '',
            manifests: entries,
            validation_status: store.validation_status ?? [],
            validation_results: store.validation_results,
            // The component knows Valid / Invalid / Unknown. Trusted is a
            // Valid manifest whose signer chains to a configured trust anchor.
            validation_state: ok ? 'Valid' : 'Invalid',
        },
    };
}

function toManifestEntry(label, m) {
    return {
        label,
        title: m.title,
        claimGenerator: m.claim_generator ?? null,
        claimGeneratorInfo: m.claim_generator_info,
        claim_version: m.claim_version,
        instanceId: m.instance_id,
        signatureInfo: m.signature_info,
        assertions: assertionRecord(m.assertions ?? []),
        credentials: m.credentials ?? [],
        thumbnail: m.thumbnail ?? null,
        ingredients: m.ingredients ?? [],
    };
}

function assertionRecord(assertions) {
    const record = {};
    for (const { label, data, instance } of assertions) {
        let key = instance > 1 ? `${label}__${instance}` : label;
        for (let n = 2; key in record; n++) key = `${label}__${n}`;
        record[key] = label.startsWith('c2pa.hash.bmff') ? trimMerkle(data) : data;
    }
    return record;
}

// A BMFF hash assertion carries one sha256 per segment per track. Keep the
// structure but replace each list of hashes with a count for display.
function trimMerkle(data) {
    if (!Array.isArray(data?.merkle)) return data;
    return {
        ...data,
        merkle: data.merkle.map(({ hashes, ...rest }) => ({
            ...rest,
            hashes: Array.isArray(hashes) ? `${hashes.length} segment hashes (omitted)` : hashes,
        })),
    };
}
