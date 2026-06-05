// tests/marketing/rate-limit-memory.test.ts
//
// Regression tests for the RateLimiter memory-leak fix (2026-06-04).
//
// Pre-fix: _buckets Map grew unbounded — one entry per distinct IP that
// ever touched the surface, never evicted. Post-fix: empty buckets are
// dropped, expired buckets are swept periodically, and the Map is capped
// at maxKeys with LRU eviction.

import { describe, it, expect } from 'vitest';
import { RateLimiter } from '$lib/services/marketing/rateLimit';

describe('RateLimiter memory bounds', () => {
	it('LRU-evicts when maxKeys is reached', () => {
		const rl = new RateLimiter(
			{ windowMs: 60_000, max: 10, maxKeys: 3, sweepEveryN: 0 },
			() => 1000,
		);
		rl.allow('a');
		rl.allow('b');
		rl.allow('c');
		expect(rl.size()).toBe(3);
		// 4th distinct key should evict 'a' (LRU).
		rl.allow('d');
		expect(rl.size()).toBe(3);
		// Touch 'b' to make it most-recent; next insert should evict 'c'.
		rl.allow('b');
		rl.allow('e');
		expect(rl.size()).toBe(3);
		// 'd', 'b', 'e' should still be tracked; 'a' and 'c' evicted.
		// We verify by adding 'a' back — if it was evicted, allow() should
		// give it a fresh window (remaining = max - 1 = 9).
		const result = rl.allow('a');
		expect(result.ok).toBe(true);
		expect(result.remaining).toBe(9);
	});

	it('periodic sweep drops expired buckets', () => {
		let now = 0;
		const rl = new RateLimiter(
			{ windowMs: 1000, max: 5, maxKeys: 1000, sweepEveryN: 3 },
			() => now,
		);
		// Three keys touched at t=0.
		rl.allow('k1');
		rl.allow('k2');
		rl.allow('k3');
		expect(rl.size()).toBe(3);
		// Advance time past the window.
		now = 5_000;
		// Sweep is per-call counter — 3 more allow()s should trigger it.
		rl.allow('newkey');
		rl.allow('newkey');
		rl.allow('newkey');
		// All three expired keys should be gone; only 'newkey' remains.
		expect(rl.size()).toBe(1);
	});

	it('__sweepForTests drops expired buckets immediately', () => {
		let now = 0;
		const rl = new RateLimiter(
			{ windowMs: 1000, max: 5, sweepEveryN: 0 },
			() => now,
		);
		rl.allow('k1');
		rl.allow('k2');
		expect(rl.size()).toBe(2);
		now = 5_000;
		rl.__sweepForTests();
		expect(rl.size()).toBe(0);
	});

	it('does not grow unbounded under simulated long-running load', () => {
		let now = 0;
		const rl = new RateLimiter(
			{ windowMs: 1000, max: 5, maxKeys: 50, sweepEveryN: 10 },
			() => now,
		);
		// Simulate 10_000 distinct IPs hitting once each, with time advancing.
		for (let i = 0; i < 10_000; i++) {
			rl.allow(`ip-${i}`);
			now += 1; // 1ms per request
		}
		// With maxKeys=50 + periodic sweep, size MUST be bounded.
		expect(rl.size()).toBeLessThanOrEqual(50);
	});
});
