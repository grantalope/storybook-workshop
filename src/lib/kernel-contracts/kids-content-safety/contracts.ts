// @graph-layer: infrastructure
// @rationale: infrastructure (kernel — layer-agnostic primitive: supervisor/ports/WAL/effects)

// src/kernel/kids-content-safety/contracts.ts
//
// Single capability contract for the kids-content safety gate.
// Mirrors the pattern in `src/kernel/decisions/contracts.ts` /
// `src/kernel/purpose/contracts.ts`.
//
// Caller allowlist:
//   - `storybook-workshop-*` covers every workshop sub-system that
//     emits free text (story-author, dedication, voice-transcript,
//     scene-brief, cover-badge — see spec §4.2).
//   - `caller-*` matches the spec-mandated generic-caller pattern
//     used by the existing privacy backend tests.
//   - explicit names cover the three early call sites used to seed
//     the migration (`storybook-workshop-author` is the canonical
//     fixture; `debug-kids-content-safety` is the live debug page).

import { defineContract, type CapabilityContract } from '$lib/kernel-contracts/types/capability';

export interface KidsContentSafetyPort {
    scan: (
        text: string,
        opts: import('$lib/kids-content-safety/types').ScanOpts,
    ) => Promise<
        import('$lib/kids-content-safety/types').ScanResult
    >;
    activeBackend: () => import(
        '$lib/kids-content-safety/types'
    ).BackendName;
    isReady: () => boolean;
    warmup: () => Promise<void>;
}

export const KIDS_CONTENT_SAFETY_CONTRACTS: CapabilityContract[] = [
    defineContract({
        name: 'kids-content.scan',
        // requirableBy: the workshop family + generic caller regex used
        // by the existing privacy backend + the canonical caller for
        // tests + the debug page that visualizes the audit ring.
        requirableBy: [
            /^storybook-workshop-.*$/,
            /^caller-.*$/,
            'storybook-workshop-author',
            'storybook-workshop-dedication',
            'storybook-workshop-voice',
            'storybook-workshop-scene-brief',
            'storybook-workshop-cover-badge',
            'storybook-workshop-safety',
            'debug-kids-content-safety',
        ],
        methods: [
            {
                name: 'scan',
                transferMode: 'clone',
                assertions: {
                    precondition: (args) => {
                        const [text, opts] = args as [unknown, { source?: unknown }];
                        if (typeof text !== 'string')
                            return 'scan text must be a string';
                        if (!opts || typeof opts !== 'object')
                            return 'scan opts must be an object';
                        if (
                            typeof opts.source !== 'string' ||
                            opts.source.length === 0
                        )
                            return 'scan opts.source must be a non-empty string';
                        return true;
                    },
                    postcondition: (result) => {
                        const r = result as { passed?: unknown; reports?: unknown };
                        if (!r || typeof r.passed !== 'boolean')
                            return 'scan result must have boolean passed';
                        if (!Array.isArray(r.reports))
                            return 'scan result.reports must be an array';
                        return true;
                    },
                },
            },
            {
                name: 'activeBackend',
                transferMode: 'clone',
                pureRead: true,
            },
            {
                name: 'isReady',
                transferMode: 'clone',
                pureRead: true,
            },
            {
                name: 'warmup',
                transferMode: 'clone',
            },
        ],
        rationale:
            'Kids-content multi-label safety classifier. Gates every LLM output ' +
            'emitted by the Storybook Workshop product branch. See spec ' +
            '2026-05-24-storybook-workshop-design.md §4.1, §4.2.',
    }),
];
