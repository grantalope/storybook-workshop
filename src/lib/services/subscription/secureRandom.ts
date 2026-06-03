// Cross-env CSPRNG int + string generators using Web Crypto.
//
// Why: per security review HIGH+MEDIUM findings, `Math.random()` was used to
// generate redeem codes (10-char, ~50-bit entropy — guessable in seconds at
// scale) and referral shortcodes (8-char, gates $5 credit payouts). Both
// must be unbiased CSPRNG-derived.
//
// Environments:
//   - Browser: `window.crypto.getRandomValues` (Web Crypto API, universal).
//   - Node 19+: `globalThis.crypto.getRandomValues` (Web Crypto on globalThis).
//   - Node 18 vitest: polyfilled in tests/setup/web-crypto-polyfill.ts.
//
// Rejection sampling: simple `% maxExclusive` would bias toward smaller values
// when the random range isn't an exact multiple. We discard draws that would
// fall in the residual region and re-sample (expected loops ~1.5 in worst case).

function getRandomValues(buf: Uint32Array): Uint32Array {
	const g = globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } };
	if (!g.crypto || !g.crypto.getRandomValues) {
		throw new Error("secureRandom: globalThis.crypto.getRandomValues unavailable — env requires Web Crypto polyfill");
	}
	return g.crypto.getRandomValues(buf);
}

export function secureRandomInt(maxExclusive: number): number {
	if (maxExclusive <= 0 || !Number.isInteger(maxExclusive)) {
		throw new Error("secureRandomInt: maxExclusive must be a positive integer");
	}
	const buf = new Uint32Array(1);
	const range = 0x1_0000_0000; // 2^32
	const limit = range - (range % maxExclusive); // rejection-sampling bound for unbiased modulo
	// expected loops: <= 2 in the worst case (when maxExclusive is just above 2^31)
	while (true) {
		getRandomValues(buf);
		if (buf[0] < limit) return buf[0] % maxExclusive;
	}
}

export function secureRandomString(length: number, alphabet: string): string {
	if (length < 0 || !Number.isInteger(length)) {
		throw new Error("secureRandomString: length must be a non-negative integer");
	}
	if (alphabet.length === 0) {
		throw new Error("secureRandomString: alphabet must be non-empty");
	}
	let out = "";
	for (let i = 0; i < length; i++) {
		out += alphabet[secureRandomInt(alphabet.length)];
	}
	return out;
}
