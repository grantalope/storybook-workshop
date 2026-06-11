import type { DialogicPrompt } from '$lib/services/author/types';

export interface WordTiming {
	word: string;
	startMs: number;
	endMs: number;
	charStart: number;
	charEnd: number;
}

export interface TtsSynthResult {
	audio: Blob | null;
	wordTimings: WordTiming[];
}

export interface TtsProvider {
	readonly name: string;
	synth(
		text: string,
		opts?: {
			voiceId?: string;
			rate?: number;
			onBoundary?: (t: WordTiming) => void;
		}
	): Promise<TtsSynthResult>;
	isAvailable(): Promise<boolean>;
}

export interface GraphemeSegment {
	grapheme: string;
	phoneme: string;
	kind:
		| 'consonant'
		| 'short-vowel'
		| 'long-vowel'
		| 'digraph'
		| 'vowel-team'
		| 'silent'
		| 'irregular';
}

export type PhonicsMap = Record<string, GraphemeSegment[]>;

export interface Tier2Annotation {
	word: string;
	spreadIndex: number;
	charStart: number;
	charEnd: number;
	definitionKid: string;
}

export interface QuizQuestion {
	type: 'recall' | 'sequence' | 'feeling';
	prompt: string;
	options: [string, string, string];
	correctIndex: 0 | 1 | 2;
}

export interface EduOverlayBundle {
	wordTimings?: Record<number, WordTiming[]>;
	phonicsMap: PhonicsMap;
	tier2Annotations: Tier2Annotation[];
	dialogicPrompts: DialogicPrompt[];
	quiz: QuizQuestion[];
}
