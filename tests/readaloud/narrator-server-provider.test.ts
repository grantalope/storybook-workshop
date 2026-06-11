import { describe, expect, it } from 'vitest';
import { NarratorServerProvider } from '$lib/services/readaloud/NarratorServerProvider';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
	return new Response(JSON.stringify(body), {
		status: init.status ?? 200,
		headers: { 'content-type': 'application/json', ...init.headers }
	});
}

describe('NarratorServerProvider', () => {
	it('decodes server audio and validates word timings', async () => {
		const fetchImpl = async (input: string | URL, init?: RequestInit) => {
			expect(String(input)).toBe('https://narrator.example/synthesize');
			expect(init?.method).toBe('POST');
			return jsonResponse({
				audioBase64: Buffer.from('RIFF').toString('base64'),
				wordTimings: [{ word: 'hello', startMs: 0, endMs: 420, charStart: 0, charEnd: 5 }]
			});
		};
		const provider = new NarratorServerProvider({ baseUrl: 'https://narrator.example/', fetchImpl });

		const result = await provider.synth('hello', { rate: 3 });
		expect(result.audio).toBeInstanceOf(Blob);
		expect(result.audio?.type).toBe('audio/wav');
		expect(result.audio?.size).toBe(4);
		expect(result.wordTimings).toEqual([
			{ word: 'hello', startMs: 0, endMs: 420, charStart: 0, charEnd: 5 }
		]);
	});

	it('returns false for a non-200 health check without throwing', async () => {
		const provider = new NarratorServerProvider({
			baseUrl: 'https://narrator.example',
			fetchImpl: async () => jsonResponse({ ok: false }, { status: 500 })
		});

		await expect(provider.isAvailable()).resolves.toBe(false);
	});

	it('returns false when no base URL is configured', async () => {
		const provider = new NarratorServerProvider({
			baseUrl: '',
			fetchImpl: async () => {
				throw new Error('fetch should not be called');
			}
		});

		await expect(provider.isAvailable()).resolves.toBe(false);
	});

	it('throws a descriptive error for malformed timings', async () => {
		const provider = new NarratorServerProvider({
			baseUrl: 'https://narrator.example',
			fetchImpl: async () =>
				jsonResponse({
					audioBase64: Buffer.from('RIFF').toString('base64'),
					wordTimings: [{ word: 'oops', startMs: 'soon', endMs: 10, charStart: 0, charEnd: 4 }]
				})
		});

		await expect(provider.synth('oops')).rejects.toThrow(/wordTimings\[0\]\.startMs/);
	});
});
