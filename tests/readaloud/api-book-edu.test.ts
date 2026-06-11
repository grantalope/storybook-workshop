import { describe, expect, it } from 'vitest';
import { GET, __grantEmailSession, __setStoreForTests, type PublicBundleSnapshot } from '../../src/routes/api/book/[shortcode]/+server';

function makeSnapshot(): PublicBundleSnapshot {
	return {
		shortcode: 'abcd2345',
		title: 'Gate Test',
		hasVoiceOver: false,
		hasDedicationAudio: false,
		spreads: Array.from({ length: 6 }, (_, index) => ({
			index,
			text: index === 5 ? 'Later secret word.' : `Visible brave word ${index}.`,
			framePngBase64: '',
			effect: 'flow'
		})),
		edu: {
			phonicsMap: {
				visible: [{ grapheme: 'v', phoneme: '/v/', kind: 'consonant' }],
				brave: [{ grapheme: 'brave', phoneme: '/brave/', kind: 'irregular' }],
				later: [{ grapheme: 'l', phoneme: '/l/', kind: 'consonant' }]
			},
			tier2Annotations: [
				{ word: 'brave', spreadIndex: 1, charStart: 8, charEnd: 13, definitionKid: 'doing hard things' },
				{ word: 'later', spreadIndex: 5, charStart: 0, charEnd: 5, definitionKid: 'after now' }
			],
			dialogicPrompts: [
				{ spreadIndex: 1, type: 'recall', text: 'What was brave?' },
				{ spreadIndex: 5, type: 'recall', text: 'What came later?' }
			],
			wordTimings: {
				1: [{ word: 'brave', startMs: 0, endMs: 300, charStart: 8, charEnd: 13 }],
				5: [{ word: 'later', startMs: 0, endMs: 300, charStart: 0, charEnd: 5 }]
			},
			quiz: [
				{ type: 'recall', prompt: 'What?', options: ['a', 'b', 'c'], correctIndex: 0 },
				{ type: 'sequence', prompt: 'First?', options: ['a', 'b', 'c'], correctIndex: 1 },
				{ type: 'feeling', prompt: 'Feel?', options: ['a', 'b', 'c'], correctIndex: 2 }
			]
		}
	};
}

async function getBundle(cookie: string | null = null) {
	const headers = cookie ? { cookie } : undefined;
	const response = await GET({
		params: { shortcode: 'abcd2345' },
		request: new Request('https://example.test/api/book/abcd2345', { headers })
	} as never);
	return response.json() as Promise<Record<string, any>>;
}

describe('GET /api/book/[shortcode] edu passthrough', () => {
	it('truncates edu overlays to gated spreads and omits the quiz', async () => {
		__setStoreForTests({ get: async () => makeSnapshot() });

		const body = await getBundle();
		expect(body.spreads.map((spread: { index: number }) => spread.index)).toEqual([0, 1, 2, 3, 4]);
		expect(body.edu.quiz).toBeUndefined();
		expect(Object.keys(body.edu.phonicsMap).sort()).toEqual(['brave', 'visible']);
		expect(body.edu.tier2Annotations).toHaveLength(1);
		expect(body.edu.dialogicPrompts).toHaveLength(1);
		expect(Object.keys(body.edu.wordTimings)).toEqual(['1']);
	});

	it('passes the full edu payload when the email gate is unlocked', async () => {
		__setStoreForTests({ get: async () => makeSnapshot() });
		const token = __grantEmailSession('abcd2345', 'reader@example.test');

		const body = await getBundle(`sw_email_gate_abcd2345=${token}`);
		expect(body.emailGateRequired).toBe(false);
		expect(body.spreads).toHaveLength(6);
		expect(body.edu.quiz).toHaveLength(3);
		expect(body.edu.tier2Annotations).toHaveLength(2);
	});
});
