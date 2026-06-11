import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = [
	'src/lib/services/readaloud',
	'src/lib/components/readaloud',
	'src/routes/(marketing)/r/[shortcode]/+page.svelte'
];

const BANNED = ['getUserMedia', 'MediaRecorder', 'SpeechRecognition', 'webkitSpeechRecognition'];

function sourceFiles(path: string): string[] {
	const stat = statSync(path);
	if (stat.isFile()) return [path];
	return readdirSync(path)
		.flatMap((entry) => sourceFiles(join(path, entry)))
		.filter((entry) => /\.(ts|svelte)$/.test(entry));
}

describe('read-aloud source guard', () => {
	it('does not use microphone or recording browser APIs', () => {
		const files = ROOTS.flatMap(sourceFiles);
		const offenders = files.flatMap((file) => {
			const source = readFileSync(file, 'utf8');
			return BANNED.filter((term) => source.includes(term)).map((term) => `${file}:${term}`);
		});
		expect(offenders).toEqual([]);
	});
});
