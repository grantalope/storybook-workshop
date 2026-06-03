// @graph-layer: private
// @rationale: private (HMAC token gating unsubscribe — prevents victim-unsub abuse)
//
// src/lib/services/marketing/unsubToken.ts
//
// HMAC-SHA256 token used to authenticate one-click unsubscribe links per
// RFC 8058 + spec §8.2 ("GDPR-clean unsubscribe").
//
// Token = HMAC-SHA256(secret, `${emailLower}:${bucket}`) truncated to 32 hex
// chars. The token binds an unsubscribe request to (email, bucket); an
// attacker who guesses or scrapes a victim's email cannot replay it for
// another recipient without the per-recipient HMAC.
//
// Same secret as the email-gate cookie HMAC so prod ops manages a single
// env var (STORYBOOK_EMAIL_GATE_SECRET).

const TOKEN_LENGTH = 32;

export interface UnsubTokenInput {
	email: string;
	bucket: string;
	secret: string;
	subtle?: SubtleCrypto;
}

/** Mint a token to embed in a per-email unsubscribe link. */
export async function mintUnsubToken(input: UnsubTokenInput): Promise<string> {
	const payload = `${input.email.toLowerCase()}:${input.bucket}`;
	const hex = await hmacSha256Hex(input.secret, payload, input.subtle);
	return hex.slice(0, TOKEN_LENGTH);
}

/** Constant-time verify a presented token against the expected HMAC. */
export async function verifyUnsubToken(
	input: UnsubTokenInput & { token: string },
): Promise<boolean> {
	if (!input.token || input.token.length !== TOKEN_LENGTH) return false;
	const expected = await mintUnsubToken(input);
	return constantTimeEqual(expected, input.token);
}

async function hmacSha256Hex(
	secret: string,
	payload: string,
	subtle?: SubtleCrypto,
): Promise<string> {
	const s =
		subtle ??
		((globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle as
			| SubtleCrypto
			| undefined);
	if (!s) {
		throw new Error('unsubToken: SubtleCrypto unavailable — env requires Web Crypto');
	}
	const enc = new TextEncoder();
	const key = await s.importKey(
		'raw',
		enc.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const sig = await s.sign('HMAC', key, enc.encode(payload));
	return Array.from(new Uint8Array(sig))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

function constantTimeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}
