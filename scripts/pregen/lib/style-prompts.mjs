// @ts-nocheck

import { readFile } from 'node:fs/promises';

export async function loadStylePrompts(stylePromptsPath) {
	if (!stylePromptsPath) return {};
	const raw = await readFile(stylePromptsPath, 'utf8');
	const parsed = JSON.parse(raw);
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('--style-prompts must point to a JSON object keyed by style id');
	}
	return parsed;
}

export function stylePromptFor(stylePrompts, styleId) {
	const configured = stylePrompts?.[styleId];
	if (!configured) {
		return {
			prefix: `${styleId} children's picture-book illustration`,
			suffix: '',
			negative: '',
		};
	}
	if (typeof configured === 'string') {
		return { prefix: configured, suffix: '', negative: '' };
	}
	return {
		prefix: configured.prefix ?? '',
		suffix: configured.suffix ?? '',
		negative: configured.negative ?? '',
	};
}
