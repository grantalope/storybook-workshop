import type { TtsProvider, TtsSynthResult, WordTiming } from './types';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface NarratorServerProviderOptions {
	baseUrl?: string;
	fetchImpl?: FetchLike;
	timeoutMs?: number;
}

interface NarratorSynthResponse {
	audioBase64: unknown;
	wordTimings: unknown;
}

export class NarratorServerProvider implements TtsProvider {
	readonly name = 'narrator-server';
	private readonly baseUrl: string;
	private readonly fetchImpl?: FetchLike;
	private readonly timeoutMs: number;

	constructor(options: NarratorServerProviderOptions = {}) {
		this.baseUrl =
			options.baseUrl !== undefined ? cleanBaseUrl(options.baseUrl) : cleanBaseUrl(readEnvBaseUrl() ?? '');
		this.fetchImpl = options.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : undefined);
		this.timeoutMs = options.timeoutMs ?? 1500;
	}

	async isAvailable(): Promise<boolean> {
		if (!this.baseUrl || !this.fetchImpl) return false;
		const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
		const timeout =
			controller && this.timeoutMs > 0
				? setTimeout(() => {
						controller.abort();
					}, this.timeoutMs)
				: null;

		try {
			const response = await this.fetchImpl(joinUrl(this.baseUrl, '/health'), {
				method: 'GET',
				signal: controller?.signal
			});
			if (!response.ok) return false;
			const body = (await response.json()) as { ok?: unknown };
			return body.ok === true;
		} catch {
			return false;
		} finally {
			if (timeout) clearTimeout(timeout);
		}
	}

	async synth(
		text: string,
		opts: { voiceId?: string; rate?: number; onBoundary?: (t: WordTiming) => void } = {}
	): Promise<TtsSynthResult> {
		if (!this.baseUrl) throw new Error('NarratorServerProvider: baseUrl is not configured');
		if (!this.fetchImpl) throw new Error('NarratorServerProvider: fetch is unavailable');

		const response = await this.fetchImpl(joinUrl(this.baseUrl, '/synthesize'), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				text,
				voiceId: opts.voiceId,
				rate: clampRate(opts.rate)
			})
		});
		if (!response.ok) {
			throw new Error(`NarratorServerProvider: synth failed with HTTP ${response.status}`);
		}

		const body = (await response.json()) as NarratorSynthResponse;
		if (typeof body.audioBase64 !== 'string') {
			throw new Error('NarratorServerProvider: invalid audioBase64');
		}
		const wordTimings = validateWordTimings(body.wordTimings);
		for (const timing of wordTimings) opts.onBoundary?.({ ...timing });
		return {
			audio: new Blob([base64ToBytes(body.audioBase64)], { type: 'audio/wav' }),
			wordTimings
		};
	}
}

export async function pickTtsProvider(providers: TtsProvider[]): Promise<TtsProvider | null> {
	for (const provider of providers) {
		try {
			if (await provider.isAvailable()) return provider;
		} catch (error) {
			console.warn(`pickTtsProvider: ${provider.name} availability check failed`, error);
		}
	}
	return null;
}

function readEnvBaseUrl(): string | undefined {
	const maybeProcess = globalThis as typeof globalThis & {
		process?: { env?: Record<string, string | undefined> };
	};
	return maybeProcess.process?.env?.NARRATOR_SERVER_URL;
}

function cleanBaseUrl(baseUrl: string): string {
	return baseUrl.trim().replace(/\/+$/, '');
}

function joinUrl(baseUrl: string, path: string): string {
	return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

function clampRate(rate: number | undefined): number {
	if (typeof rate !== 'number' || !Number.isFinite(rate)) return 1;
	return Math.min(1.5, Math.max(0.5, rate));
}

function validateWordTimings(value: unknown): WordTiming[] {
	if (!Array.isArray(value)) {
		throw new Error('NarratorServerProvider: invalid wordTimings');
	}
	return value.map((item, index) => validateWordTiming(item, index));
}

function validateWordTiming(value: unknown, index: number): WordTiming {
	const item = value as Partial<WordTiming>;
	const prefix = `NarratorServerProvider: invalid wordTimings[${index}]`;
	if (!item || typeof item !== 'object') throw new Error(prefix);
	if (typeof item.word !== 'string' || item.word.length === 0) throw new Error(`${prefix}.word`);
	if (!isFiniteNumber(item.startMs)) throw new Error(`${prefix}.startMs`);
	if (!isFiniteNumber(item.endMs)) throw new Error(`${prefix}.endMs`);
	if (!isFiniteNumber(item.charStart)) throw new Error(`${prefix}.charStart`);
	if (!isFiniteNumber(item.charEnd)) throw new Error(`${prefix}.charEnd`);
	if (item.endMs < item.startMs) throw new Error(`${prefix}.endMs`);
	if (item.charEnd < item.charStart) throw new Error(`${prefix}.charEnd`);
	return {
		word: item.word,
		startMs: item.startMs,
		endMs: item.endMs,
		charStart: item.charStart,
		charEnd: item.charEnd
	};
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function base64ToBytes(base64: string): Uint8Array {
	if (typeof Buffer !== 'undefined') {
		return new Uint8Array(Buffer.from(base64, 'base64'));
	}
	const decoded = atob(base64);
	const bytes = new Uint8Array(decoded.length);
	for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
	return bytes;
}
