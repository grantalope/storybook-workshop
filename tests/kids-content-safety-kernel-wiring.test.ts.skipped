/**
 * KidsContentSafety — kernel wiring acceptance.
 *
 * Validates:
 *   1. The contract is published under the expected capability name.
 *   2. The requirableBy allowlist accepts `storybook-workshop-author`
 *      (the canonical caller from spec §4.2).
 *   3. The requirableBy allowlist accepts the `storybook-workshop-*`
 *      regex family.
 *   4. The `caller-*` regex family is honoured (parity with privacy
 *      backend tests).
 *   5. End-to-end: kernel.boot([manifest], [contract]) + kernel.connect()
 *      returns a working port whose `scan()` method delegates to the
 *      live service singleton.
 *   6. The port's `activeBackend()` + `isReady()` pass through.
 *   7. Disallowed callers (e.g. `random-evil-caller`) are rejected.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { Kernel } from '$lib/kernel-contracts/boot/kernel';
import {
    KIDS_CONTENT_SAFETY_CONTRACTS,
    kidsContentSafetyManifest,
    type KidsContentSafetyPort,
} from '../../src/kernel/kids-content-safety';
import {
    kidsContentSafetyService,
} from '$lib/kids-content-safety';

beforeEach(() => {
    kidsContentSafetyService._resetForTests();
    kidsContentSafetyService._setProbeOrderForTests(['stub']);
});

describe('Kernel wiring — contract shape', () => {
    it('exports exactly one capability contract', () => {
        expect(KIDS_CONTENT_SAFETY_CONTRACTS.length).toBe(1);
    });

    it('contract name is "kids-content.scan"', () => {
        expect(KIDS_CONTENT_SAFETY_CONTRACTS[0].name).toBe('kids-content.scan');
    });

    it('contract declares the scan method', () => {
        const methods = KIDS_CONTENT_SAFETY_CONTRACTS[0].methods.map(
            (m) => m.name,
        );
        expect(methods).toContain('scan');
    });

    it('contract declares the warmup method', () => {
        const methods = KIDS_CONTENT_SAFETY_CONTRACTS[0].methods.map(
            (m) => m.name,
        );
        expect(methods).toContain('warmup');
    });

    it('contract declares the isReady method', () => {
        const methods = KIDS_CONTENT_SAFETY_CONTRACTS[0].methods.map(
            (m) => m.name,
        );
        expect(methods).toContain('isReady');
    });

    it('contract declares the activeBackend method', () => {
        const methods = KIDS_CONTENT_SAFETY_CONTRACTS[0].methods.map(
            (m) => m.name,
        );
        expect(methods).toContain('activeBackend');
    });
});

describe('Kernel wiring — requirableBy allowlist', () => {
    function allowed(caller: string): boolean {
        const list = KIDS_CONTENT_SAFETY_CONTRACTS[0].requirableBy;
        return list.some((m) =>
            typeof m === 'string' ? m === caller : m.test(caller),
        );
    }

    it('allows the canonical storybook-workshop-author caller', () => {
        expect(allowed('storybook-workshop-author')).toBe(true);
    });

    it('allows any storybook-workshop-* caller via regex', () => {
        expect(allowed('storybook-workshop-newcaller')).toBe(true);
        expect(allowed('storybook-workshop-rare-edge-case')).toBe(true);
    });

    it('allows generic caller-* regex (privacy-backend parity)', () => {
        expect(allowed('caller-test-only')).toBe(true);
    });

    it('allows the debug page caller explicitly', () => {
        expect(allowed('debug-kids-content-safety')).toBe(true);
    });

    it('rejects callers outside the allowlist', () => {
        expect(allowed('random-evil-caller')).toBe(false);
        expect(allowed('claws.something')).toBe(false);
    });
});

describe('Kernel wiring — manifest shape', () => {
    it('manifest is named "kids-content-safety"', () => {
        expect(kidsContentSafetyManifest.name).toBe('kids-content-safety');
    });

    it('manifest is colocated', () => {
        expect(kidsContentSafetyManifest.placement).toBe('colocated');
    });

    it('manifest publishes kids-content.scan', () => {
        expect(kidsContentSafetyManifest.publishes).toContain('kids-content.scan');
    });

    it('manifest priority is background', () => {
        expect(kidsContentSafetyManifest.priority).toBe('background');
    });

    it('manifest state is volatile (audit ring is in-memory)', () => {
        expect(kidsContentSafetyManifest.state).toBe('volatile');
    });
});

describe('Kernel wiring — end-to-end boot + connect + scan', () => {
    it('kernel.boot([manifest],[contract]) + connect returns a working port', async () => {
        const kernel = new Kernel({ dbName: `kcs-wiring-${Math.random()}` });
        await kernel.boot([kidsContentSafetyManifest], KIDS_CONTENT_SAFETY_CONTRACTS);

        const port = await kernel.connect<KidsContentSafetyPort>(
            'kids-content.scan',
            'storybook-workshop-author',
        );
        expect(typeof port.scan).toBe('function');
        expect(typeof port.activeBackend).toBe('function');
        expect(typeof port.isReady).toBe('function');
        await kernel.shutdown();
    });

    it('port.scan delegates to the service and returns a ScanResult', async () => {
        const kernel = new Kernel({ dbName: `kcs-wiring-scan-${Math.random()}` });
        await kernel.boot([kidsContentSafetyManifest], KIDS_CONTENT_SAFETY_CONTRACTS);
        const port = await kernel.connect<KidsContentSafetyPort>(
            'kids-content.scan',
            'storybook-workshop-author',
        );
        const result = await port.scan('The rabbit hopped through the meadow.', {
            source: 'story_author',
        });
        expect(result.passed).toBe(true);
        expect(Array.isArray(result.reports)).toBe(true);
        expect(typeof result.scanLatencyMs).toBe('number');
        await kernel.shutdown();
    });

    it('port.scan on violent input returns passed=false', async () => {
        const kernel = new Kernel({ dbName: `kcs-wiring-fail-${Math.random()}` });
        await kernel.boot([kidsContentSafetyManifest], KIDS_CONTENT_SAFETY_CONTRACTS);
        const port = await kernel.connect<KidsContentSafetyPort>(
            'kids-content.scan',
            'storybook-workshop-author',
        );
        const result = await port.scan(
            'The witch tried to kill the children.',
            { source: 'story_author' },
        );
        expect(result.passed).toBe(false);
        await kernel.shutdown();
    });

    it('port.activeBackend reflects the resolved backend', async () => {
        const kernel = new Kernel({ dbName: `kcs-wiring-active-${Math.random()}` });
        await kernel.boot([kidsContentSafetyManifest], KIDS_CONTENT_SAFETY_CONTRACTS);
        const port = await kernel.connect<KidsContentSafetyPort>(
            'kids-content.scan',
            'storybook-workshop-author',
        );
        // Trigger warmup via a scan.
        await port.scan('hello', { source: 'story_author' });
        const backend = await port.activeBackend();
        expect(['webgpu', 'wasm', 'ollama', 'stub']).toContain(backend);
        await kernel.shutdown();
    });

    it('disallowed caller cannot connect', async () => {
        const kernel = new Kernel({ dbName: `kcs-wiring-deny-${Math.random()}` });
        await kernel.boot([kidsContentSafetyManifest], KIDS_CONTENT_SAFETY_CONTRACTS);
        await expect(
            kernel.connect<KidsContentSafetyPort>(
                'kids-content.scan',
                'random-evil-caller',
            ),
        ).rejects.toThrow();
        await kernel.shutdown();
    });

    it('allowed storybook-workshop-dedication caller can connect', async () => {
        const kernel = new Kernel({ dbName: `kcs-wiring-ded-${Math.random()}` });
        await kernel.boot([kidsContentSafetyManifest], KIDS_CONTENT_SAFETY_CONTRACTS);
        const port = await kernel.connect<KidsContentSafetyPort>(
            'kids-content.scan',
            'storybook-workshop-dedication',
        );
        expect(typeof port.scan).toBe('function');
        await kernel.shutdown();
    });
});
