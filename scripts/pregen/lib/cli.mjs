// @ts-nocheck

const LIST_FLAGS = new Set(['styles', 'expectStyles']);
const NUMBER_FLAGS = new Set([
	'limit',
	'steps',
	'concurrency',
	'threshold',
	'tolerance',
	'pollIntervalMs',
	'timeoutMs',
]);
const BOOLEAN_FLAGS = new Set(['dryRun']);
const KNOWN_FLAGS = new Set([
	'bank',
	'concurrency',
	'dryRun',
	'embedder',
	'expectStyles',
	'filter',
	'in',
	'limit',
	'out',
	'pollIntervalMs',
	'portraits',
	'server',
	'steps',
	'stylePrompts',
	'styles',
	'taxonomy',
	'threshold',
	'timeoutMs',
	'tolerance',
]);

function toCamel(flagName) {
	return flagName.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function flagLabel(name) {
	return `--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

function parseNumber(name, value) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		throw new Error(`${flagLabel(name)} must be a finite number`);
	}
	if (['limit', 'steps', 'concurrency', 'pollIntervalMs', 'timeoutMs', 'tolerance'].includes(name)) {
		if (!Number.isInteger(parsed) || parsed < 0) {
			throw new Error(`${flagLabel(name)} must be a non-negative integer`);
		}
	}
	return parsed;
}

function parseList(value) {
	return String(value)
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean);
}

export function parseArgs(argv, spec = {}) {
	const values = {
		concurrency: 1,
		steps: 4,
		pollIntervalMs: 1500,
		timeoutMs: 180000,
		...(spec.defaults ?? {}),
	};
	const required = (spec.required ?? []).map(toCamel);
	const positional = [];

	for (let index = 0; index < argv.length; index += 1) {
		const raw = argv[index];
		if (!raw.startsWith('--')) {
			positional.push(raw);
			continue;
		}

		const [flagPart, inlineValue] = raw.slice(2).split(/=(.*)/s, 2);
		const name = toCamel(flagPart);
		if (!KNOWN_FLAGS.has(name)) {
			throw new Error(`Unknown flag ${flagLabel(name)}`);
		}

		if (BOOLEAN_FLAGS.has(name)) {
			values[name] = inlineValue === undefined ? true : inlineValue !== 'false';
			continue;
		}

		const value = inlineValue ?? argv[index + 1];
		if (value === undefined || value.startsWith('--')) {
			throw new Error(`${flagLabel(name)} requires a value`);
		}
		if (inlineValue === undefined) index += 1;

		if (LIST_FLAGS.has(name)) {
			values[name] = parseList(value);
		} else if (NUMBER_FLAGS.has(name)) {
			values[name] = parseNumber(name, value);
		} else {
			values[name] = value;
		}
	}

	if (values.concurrency !== 1) {
		throw new Error('--concurrency max is 1; ComfyUI queueing is intentionally sequential');
	}

	const missing = required.filter((name) => {
		const value = values[name];
		return value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
	});
	if (missing.length > 0) {
		throw new Error(`Missing required flag(s): ${missing.map(flagLabel).join(', ')}`);
	}

	return { ...values, positional };
}
