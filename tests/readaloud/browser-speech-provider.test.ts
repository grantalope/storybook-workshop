import { describe, expect, it } from 'vitest';
import { BrowserSpeechProvider } from '$lib/services/readaloud/BrowserSpeechProvider';

interface FakeUtterance {
	text: string;
	rate: number;
	voice: SpeechSynthesisVoice | null;
	onboundary: ((event: SpeechSynthesisEvent) => void) | null;
	onend: ((event: SpeechSynthesisEvent) => void) | null;
	onerror: ((event: SpeechSynthesisErrorEvent) => void) | null;
}

class FakeSynthesis {
	lastUtterance: FakeUtterance | null = null;
	cancelCalls = 0;

	getVoices(): SpeechSynthesisVoice[] {
		return [];
	}

	cancel(): void {
		this.cancelCalls++;
	}

	speak(utterance: SpeechSynthesisUtterance): void {
		this.lastUtterance = utterance as unknown as FakeUtterance;
	}
}

function makeProvider(fake = new FakeSynthesis()) {
	return {
		fake,
		provider: new BrowserSpeechProvider({
			synthesis: fake,
			createUtterance: (text) => ({
				text,
				rate: 1,
				voice: null,
				onboundary: null,
				onend: null,
				onerror: null
			})
		})
	};
}

describe('BrowserSpeechProvider', () => {
	it('converts boundary events into monotonic word timings', async () => {
		const { fake, provider } = makeProvider();
		const resultPromise = provider.synth('Ship cake.');

		fake.lastUtterance?.onboundary?.({ charIndex: 0, elapsedTime: 0 } as SpeechSynthesisEvent);
		fake.lastUtterance?.onboundary?.({ charIndex: 5, elapsedTime: 0.6 } as SpeechSynthesisEvent);
		fake.lastUtterance?.onend?.({ elapsedTime: 1.2 } as SpeechSynthesisEvent);

		const result = await resultPromise;
		expect(result.audio).toBeNull();
		expect(result.wordTimings).toEqual([
			{ word: 'Ship', startMs: 0, endMs: 600, charStart: 0, charEnd: 4 },
			{ word: 'cake', startMs: 600, endMs: 1200, charStart: 5, charEnd: 9 }
		]);
	});

	it('clamps the requested rate to the browser-safe range', async () => {
		const { fake, provider } = makeProvider();
		const resultPromise = provider.synth('Fast word', { rate: 8 });
		expect(fake.lastUtterance?.rate).toBe(1.5);
		fake.lastUtterance?.onend?.({ elapsedTime: 0 } as SpeechSynthesisEvent);
		await resultPromise;

		const slowPromise = provider.synth('Slow word', { rate: 0.1 });
		expect(fake.lastUtterance?.rate).toBe(0.5);
		fake.lastUtterance?.onend?.({ elapsedTime: 0 } as SpeechSynthesisEvent);
		await slowPromise;
	});

	it('streams finalized word boundaries in reading order', async () => {
		const { fake, provider } = makeProvider();
		const streamed: string[] = [];
		const resultPromise = provider.synth('one two', {
			onBoundary: (timing) => streamed.push(`${timing.word}:${timing.endMs}`)
		});

		fake.lastUtterance?.onboundary?.({ charIndex: 0, elapsedTime: 0 } as SpeechSynthesisEvent);
		expect(streamed).toEqual([]);
		fake.lastUtterance?.onboundary?.({ charIndex: 4, elapsedTime: 0.4 } as SpeechSynthesisEvent);
		expect(streamed).toEqual(['one:400']);
		fake.lastUtterance?.onend?.({ elapsedTime: 0.9 } as SpeechSynthesisEvent);

		await resultPromise;
		expect(streamed).toEqual(['one:400', 'two:900']);
	});
});
