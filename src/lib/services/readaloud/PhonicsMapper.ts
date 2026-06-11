import type { GraphemeSegment, PhonicsMap } from './types';

const IRREGULAR_WORDS = new Set([
	'the',
	'said',
	'was',
	'of',
	'one',
	'two',
	'you',
	'your',
	'they',
	'there',
	'where',
	'who',
	'what',
	'friend',
	'again',
	'could',
	'would',
	'should',
	'because',
	'people',
	'laugh',
	'thought',
	'through',
	'though',
	'enough',
	'young',
	'give',
	'have',
	'come',
	'some',
	'done',
	'gone',
	'once',
	'does',
	'busy',
	'pretty',
	'very',
	'were',
	'are',
	'eye',
	'heart',
	'build',
	'been',
	'many',
	'any'
]);

const DIGRAPH_PHONEMES: Record<string, string> = {
	sh: '/sh/',
	ch: '/ch/',
	th: '/th/',
	ph: '/f/',
	wh: '/w/',
	ck: '/k/',
	ng: '/ng/'
};

const VOWEL_TEAM_PHONEMES: Record<string, string> = {
	ai: '/ā/',
	ay: '/ā/',
	ea: '/ē/',
	ee: '/ē/',
	oa: '/ō/',
	oo: '/oo/',
	igh: '/ī/',
	ie: '/ī/',
	ou: '/ow/',
	ow: '/ow/'
};

const SHORT_VOWELS: Record<string, string> = {
	a: '/ă/',
	e: '/ĕ/',
	i: '/ĭ/',
	o: '/ŏ/',
	u: '/ŭ/'
};

const LONG_VOWELS: Record<string, string> = {
	a: '/ā/',
	e: '/ē/',
	i: '/ī/',
	o: '/ō/',
	u: '/ū/'
};

const CONSONANT_PHONEMES: Record<string, string> = {
	c: '/k/',
	g: '/g/',
	j: '/j/',
	q: '/kw/',
	x: '/ks/',
	y: '/y/'
};

export function buildPhonicsMap(words: string[]): PhonicsMap {
	const unique = Array.from(new Set(words.map(normalizeWord).filter(Boolean))).sort();
	const out: PhonicsMap = {};
	for (const word of unique) {
		out[word] = mapWord(word);
	}
	return out;
}

function normalizeWord(word: string): string {
	return word
		.toLocaleLowerCase('en-US')
		.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

function mapWord(word: string): GraphemeSegment[] {
	if (IRREGULAR_WORDS.has(word)) {
		return [{ grapheme: word, phoneme: `/${word}/`, kind: 'irregular' }];
	}

	const segments: GraphemeSegment[] = [];
	for (let i = 0; i < word.length; ) {
		if (isSilentFinalE(word, i)) {
			segments.push({ grapheme: word[i], phoneme: '', kind: 'silent' });
			i++;
			continue;
		}

		const three = word.slice(i, i + 3);
		if (VOWEL_TEAM_PHONEMES[three]) {
			segments.push({ grapheme: three, phoneme: VOWEL_TEAM_PHONEMES[three], kind: 'vowel-team' });
			i += 3;
			continue;
		}

		const two = word.slice(i, i + 2);
		if (DIGRAPH_PHONEMES[two]) {
			segments.push({ grapheme: two, phoneme: DIGRAPH_PHONEMES[two], kind: 'digraph' });
			i += 2;
			continue;
		}
		if (VOWEL_TEAM_PHONEMES[two]) {
			segments.push({ grapheme: two, phoneme: VOWEL_TEAM_PHONEMES[two], kind: 'vowel-team' });
			i += 2;
			continue;
		}

		const grapheme = word[i];
		if (isVowel(grapheme)) {
			const long = isLongSilentEVowel(word, i);
			segments.push({
				grapheme,
				phoneme: long ? LONG_VOWELS[grapheme] : SHORT_VOWELS[grapheme],
				kind: long ? 'long-vowel' : 'short-vowel'
			});
		} else {
			segments.push({
				grapheme,
				phoneme: CONSONANT_PHONEMES[grapheme] ?? `/${grapheme}/`,
				kind: 'consonant'
			});
		}
		i++;
	}
	return segments;
}

function isVowel(char: string): boolean {
	return ['a', 'e', 'i', 'o', 'u'].includes(char);
}

function isConsonant(char: string): boolean {
	return !!char && !isVowel(char);
}

function isSilentFinalE(word: string, index: number): boolean {
	return index === word.length - 1 && word[index] === 'e' && isLongSilentEVowel(word, word.length - 3);
}

function isLongSilentEVowel(word: string, index: number): boolean {
	return (
		word.length >= 4 &&
		index === word.length - 3 &&
		isVowel(word[index]) &&
		isConsonant(word[index + 1]) &&
		word.endsWith('e')
	);
}
