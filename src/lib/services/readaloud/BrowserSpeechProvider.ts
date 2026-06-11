import type { TtsProvider, TtsSynthResult, WordTiming } from './types';

type SpeechSynthesisLike = Pick<SpeechSynthesis, 'speak' | 'cancel' | 'getVoices'>;

interface UtteranceLike {
	text: string;
	rate: number;
	voice: SpeechSynthesisVoice | null;
	onboundary: ((event: SpeechSynthesisEvent) => void) | null;
	onend: ((event: SpeechSynthesisEvent) => void) | null;
	onerror: ((event: SpeechSynthesisErrorEvent) => void) | null;
}

interface WordSpan {
	word: string;
	charStart: number;
	charEnd: number;
}

export interface BrowserSpeechProviderOptions {
	synthesis?: SpeechSynthesisLike;
	createUtterance?: (text: string) => UtteranceLike;
}

const WORD_RE = /[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu;

function clampRate(rate: number | undefined): number {
	if (typeof rate !== 'number' || !Number.isFinite(rate)) return 1;
	return Math.min(1.5, Math.max(0.5, rate));
}

function extractWordSpans(text: string): WordSpan[] {
	const spans: WordSpan[] = [];
	for (const match of text.matchAll(WORD_RE)) {
		const word = match[0];
		const charStart = match.index ?? 0;
		spans.push({ word, charStart, charEnd: charStart + word.length });
	}
	return spans;
}

function findSpanForBoundary(spans: WordSpan[], charIndex: number): WordSpan | null {
	return (
		spans.find((span) => charIndex >= span.charStart && charIndex < span.charEnd) ??
		spans.find((span) => span.charStart >= charIndex) ??
		null
	);
}

function elapsedMs(event: SpeechSynthesisEvent): number {
	const elapsedTime = Number(event.elapsedTime);
	return Number.isFinite(elapsedTime) ? Math.max(0, Math.round(elapsedTime * 1000)) : 0;
}

export class BrowserSpeechProvider implements TtsProvider {
	readonly name = 'browser-speech';
	private readonly synthesis?: SpeechSynthesisLike;
	private readonly createUtterance?: (text: string) => UtteranceLike;

	constructor(options: BrowserSpeechProviderOptions = {}) {
		this.synthesis = options.synthesis;
		this.createUtterance = options.createUtterance;
	}

	async isAvailable(): Promise<boolean> {
		return !!this.resolveSynthesis() && !!this.resolveUtteranceFactory();
	}

	async synth(
		text: string,
		opts: { voiceId?: string; rate?: number; onBoundary?: (t: WordTiming) => void } = {}
	): Promise<TtsSynthResult> {
		const synthesis = this.resolveSynthesis();
		const createUtterance = this.resolveUtteranceFactory();
		if (!synthesis || !createUtterance) {
			throw new Error('BrowserSpeechProvider: browser speech synthesis is unavailable');
		}

		const spans = extractWordSpans(text);
		const utterance = createUtterance(text);
		utterance.rate = clampRate(opts.rate);
		utterance.voice = this.findVoice(synthesis, opts.voiceId);

		const timings: WordTiming[] = [];
		const seenStarts = new Set<number>();
		let pending: WordTiming | null = null;

		function emitPending(endMs: number) {
			if (!pending) return;
			pending.endMs = Math.max(endMs, pending.startMs + 1);
			timings.push(pending);
			opts.onBoundary?.({ ...pending });
			pending = null;
		}

		return new Promise<TtsSynthResult>((resolve, reject) => {
			utterance.onboundary = (event) => {
				const span = findSpanForBoundary(spans, Number(event.charIndex));
				if (!span || seenStarts.has(span.charStart)) return;
				const startMs = elapsedMs(event);
				emitPending(startMs);
				seenStarts.add(span.charStart);
				pending = {
					word: span.word,
					startMs,
					endMs: startMs,
					charStart: span.charStart,
					charEnd: span.charEnd
				};
			};

			utterance.onend = (event) => {
				emitPending(elapsedMs(event));
				resolve({ audio: null, wordTimings: timings.map((timing) => ({ ...timing })) });
			};

			utterance.onerror = (event) => {
				reject(new Error(`BrowserSpeechProvider: speech synthesis failed (${event.error})`));
			};

			synthesis.cancel();
			synthesis.speak(utterance as SpeechSynthesisUtterance);
		});
	}

	private resolveSynthesis(): SpeechSynthesisLike | undefined {
		if (this.synthesis) return this.synthesis;
		return typeof speechSynthesis !== 'undefined' ? speechSynthesis : undefined;
	}

	private resolveUtteranceFactory(): ((text: string) => UtteranceLike) | undefined {
		if (this.createUtterance) return this.createUtterance;
		if (typeof SpeechSynthesisUtterance === 'undefined') return undefined;
		return (text: string) => new SpeechSynthesisUtterance(text) as UtteranceLike;
	}

	private findVoice(synthesis: SpeechSynthesisLike, voiceId: string | undefined): SpeechSynthesisVoice | null {
		if (!voiceId) return null;
		return synthesis.getVoices().find((voice) => voice.voiceURI === voiceId || voice.name === voiceId) ?? null;
	}
}
