// @graph-layer: private
// @rationale: private (email is PII tier; HMAC cookie binds shortcode to email)
//
// src/lib/services/marketing/EmailGateService.ts
//
// Email-gate cookie + CRM contact registration.
//
// Soft email gate: anonymous parent builds a book in the workshop, the
// first 4 spreads of the read-along preview are public, and the gate
// kicks in beyond page 4 (per spec §8.1). When the parent submits their
// email:
//
//   1. CRM contact is upserted with anonymized tags (age band, theme,
//      length tier, archetype family — no kid PII).
//   2. Signed HMAC cookie `swEmailGate=<hex>` is returned. The cookie
//      value is `HMAC-SHA256(serverSecret, "{email}:{shortcode}")`,
//      truncated to 32 hex chars. Cookies bind email-to-shortcode so a
//      single account doesn't unlock arbitrary other shortcodes.
//   3. Lifecycle scheduler is notified — caller composes the
//      LifecycleEmailService.scheduleForContact(contact) right after.
//
// Idempotency: re-submitting the same email for the same shortcode
// returns the SAME cookie and does NOT re-fire the gate-unlock email.
//
// Spec: docs/specs/2026-05-24-design.md §8.1

import type {
	CrmContact,
	EmailGateRecordOpts,
	EmailGateResult,
	UnsubscribeBucket,
} from './types';

export interface EmailGateServiceOpts {
	/** Server-side HMAC secret. Required; throw if undefined / empty. */
	serverSecret: string;
	nowSource?: () => number;
	/** Optional override for the default Web Crypto subtle. */
	subtle?: SubtleCrypto;
	/**
	 * Hard deadline (epoch ms) after which legacy (un-prefixed) cookies
	 * are REJECTED. Used during HMAC-secret rotation: callers set this to
	 * (rotationStart + graceWindow) so legacy cookies stop validating once
	 * the grace window elapses. Default is undefined which means "no
	 * legacy acceptance" — only v1:-prefixed cookies validate.
	 *
	 * This is a launch deployment so there are NO pre-existing legacy
	 * cookies in the wild; the default is to reject them. The dual-path
	 * code stays in place so a future rotation can set this in opts
	 * without touching the verify path.
	 */
	legacyCookieAcceptUntilMs?: number;
}

/**
 * Default unsubscribe state on a fresh contact: opted IN to marketing
 * and educational (parent just gave us their email), opted IN to
 * transactional because that's how order confirmations / shipping
 * updates flow.
 */
const DEFAULT_UNSUB: Record<UnsubscribeBucket, boolean> = {
	transactional: false,
	marketing: false,
	educational: false,
};


export class InvalidEmailError extends Error {
	constructor(email: string) {
		super("invalid email: " + email);
		this.name = "InvalidEmailError";
	}
}

export class InvalidShortcodeError extends Error {
	constructor(shortcode: string) {
		super("invalid shortcode: " + shortcode);
		this.name = "InvalidShortcodeError";
	}
}

export class EmailGateService {
	private _contacts = new Map<string, CrmContact>();
	/** Shortcode-to-email-to-cookie idempotency table. */
	private _cookies = new Map<string, string>();
	/**
	 * In-memory-only kid name map: emailLower -> sanitized first name.
	 * NEVER persisted to CrmContact.tags or shipped to external CRM.
	 * Used only for local email rendering via getKidName().
	 */
	private _kidNames = new Map<string, string>();

	constructor(private opts: EmailGateServiceOpts) {
		if (!opts.serverSecret || opts.serverSecret.length < 8) {
			throw new Error('EmailGateService: serverSecret must be >= 8 chars');
		}
	}

	private _now(): number {
		return (this.opts.nowSource ?? (() => Date.now()))();
	}

	/**
	 * Record an email-gate submission. Idempotent: re-submitting the same
	 * email for the same shortcode returns the same cookie, does NOT bump
	 * createdAt, does NOT mark the contact as a duplicate signup.
	 */
	async record(opts: EmailGateRecordOpts): Promise<EmailGateResult> {
		this._validateEmail(opts.email);
		this._validateShortcode(opts.shortcode);

		const cookieKey = this._cookieKey(opts.email, opts.shortcode);
		const existing = this._cookies.get(cookieKey);
		if (existing && this._contacts.has(opts.email.toLowerCase())) {
			const contact = this._contacts.get(opts.email.toLowerCase())!;
			return { contact, cookieValue: existing, reused: true };
		}

		const cookie = await this._mintCookie(opts.email, opts.shortcode);
		this._cookies.set(cookieKey, cookie);

		const key = opts.email.toLowerCase();

		// kidFirstName: store in in-memory-only map, never in contact.tags.
		if (opts.kidFirstName !== undefined) {
			const clean = sanitizeName(opts.kidFirstName);
			if (clean) this._kidNames.set(key, clean);
		}

		let contact = this._contacts.get(key);
		if (!contact) {
			contact = {
				email: opts.email,
				createdAt: this._now(),
				lifecycleStage: 'gate_unlocked',
				tags: {
					kidAgeBand: opts.kidAgeBand,
					themePicked: opts.themePicked,
					lengthTier: opts.lengthTier,
					pillarArchetypeFamily: opts.pillarArchetypeFamily,
					// kidFirstName intentionally omitted from tags (privacy fix cluster-D).
				},
				unsubscribed: { ...DEFAULT_UNSUB },
				lastShortcode: opts.shortcode,
				templateLastSentAt: {},
			};
			this._contacts.set(key, contact);
		} else {
			// Already-known parent unlocking a new shortcode — update lastShortcode but
			// preserve their lifecycle stage + unsubscribe history. Tags merge (last-write
			// wins for set fields).
			contact.lastShortcode = opts.shortcode;
			if (opts.kidAgeBand) contact.tags.kidAgeBand = opts.kidAgeBand;
			if (opts.themePicked) contact.tags.themePicked = opts.themePicked;
			if (opts.lengthTier) contact.tags.lengthTier = opts.lengthTier;
			if (opts.pillarArchetypeFamily) {
				contact.tags.pillarArchetypeFamily = opts.pillarArchetypeFamily;
			}
			// kidFirstName: update in-memory map only, never contact.tags.
			if (opts.kidFirstName !== undefined) {
				const clean = sanitizeName(opts.kidFirstName);
				if (clean) this._kidNames.set(key, clean);
			}
		}

		return { contact, cookieValue: cookie, reused: false };
	}

	/**
	 * Return the in-memory-only kid name for local email rendering.
	 * MUST NOT be forwarded to crm.send() vars.
	 */
	getKidName(email: string): string | undefined {
		return this._kidNames.get(email.toLowerCase());
	}

	/** Look up a contact (caller uses to drive lifecycle dispatch). */
	getContact(email: string): CrmContact | undefined {
		return this._contacts.get(email.toLowerCase());
	}

	/**
	 * Verify a cookie value matches the expected HMAC.
	 *
	 * Two formats are accepted:
	 *   - "v1:<32 hex>" — current format. ALWAYS validated.
	 *   - bare 32-hex (legacy, pre-v1 prefix) — ONLY accepted while
	 *     `now < opts.legacyCookieAcceptUntilMs`. If the opt is unset (the
	 *     default for a fresh launch) or the deadline has passed, legacy
	 *     cookies are rejected.
	 *
	 * Rationale: launch deployments have no legacy cookies in the wild so
	 * the default is to reject them. A future HMAC-secret rotation can
	 * widen the dual-path window by setting `legacyCookieAcceptUntilMs`
	 * to `rotationStartMs + 30 * 86400_000` (30-day grace) without code
	 * changes.
	 */
	async verifyCookie(email: string, shortcode: string, cookieValue: string): Promise<boolean> {
		if (!email || !shortcode || !cookieValue) return false;
		const expected = await this._mintCookie(email, shortcode);
		if (constantTimeEqual(expected, cookieValue)) return true;
		// Legacy (pre-v1 prefix) cookies are plain 32-hex with no version byte.
		// Accept them ONLY while the rotation grace window is open.
		if (!cookieValue.startsWith("v1:")) {
			const deadline = this.opts.legacyCookieAcceptUntilMs;
			if (deadline === undefined) return false; // launch default: no legacy
			if (this._now() > deadline) return false; // grace window elapsed
			const legacy = expected.startsWith("v1:") ? expected.slice(3) : expected;
			if (constantTimeEqual(legacy, cookieValue)) return true;
		}
		return false;
	}

	/** Marks a contact lifecycle stage. Used by other services. */
	advanceStage(email: string, stage: CrmContact['lifecycleStage']): void {
		const key = email.toLowerCase();
		const contact = this._contacts.get(key);
		if (contact) contact.lifecycleStage = stage;
	}

	/** Toggle per-bucket unsubscribe flag. */
	setUnsubscribed(email: string, bucket: UnsubscribeBucket, value: boolean): void {
		const key = email.toLowerCase();
		const contact = this._contacts.get(key);
		if (contact) {
			contact.unsubscribed[bucket] = value;
			if (bucket === 'marketing' && value) {
				// hard-cascade: marketing unsubscribe also halts educational drip
				contact.unsubscribed.educational = true;
			}
		}
	}

	/** Hard-delete a contact (GDPR account delete cascade). */
	deleteContact(email: string): boolean {
		const key = email.toLowerCase();
		this._kidNames.delete(key); // purge in-memory kid name (privacy)
		return this._contacts.delete(key);
	}

	/** All known contacts — used by lifecycle tick. */
	allContacts(): CrmContact[] {
		return Array.from(this._contacts.values());
	}

	private _cookieKey(email: string, shortcode: string): string {
		return `${email.toLowerCase()}:${shortcode}`;
	}

	/**
	 * Cookie format: `v1:<32 hex>` (HMAC-SHA256 of `<emailLower>:<shortcode>`).
	 * Prefix is a version byte so future key rotation can validate against
	 * multiple HMAC variants in parallel without invalidating every minted
	 * cookie at once. verifyCookie dispatches by prefix.
	 */
	private async _mintCookie(email: string, shortcode: string): Promise<string> {
		const payload = `${email.toLowerCase()}:${shortcode}`;
		const hex = await hmacSha256Hex(this.opts.serverSecret, payload, this.opts.subtle);
		return `v1:${hex.slice(0, 32)}`;
	}

	private _validateEmail(email: string): void {
		if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			throw new InvalidEmailError(email);
		}
	}

	private _validateShortcode(shortcode: string): void {
		if (!shortcode || shortcode.length < 4) {
			throw new InvalidShortcodeError(shortcode);
		}
	}
}

// ---------------------------------------------------------------------------
// HMAC helper (Web Crypto / vitest polyfill)
// ---------------------------------------------------------------------------

async function hmacSha256Hex(
	secret: string,
	payload: string,
	subtle?: SubtleCrypto,
): Promise<string> {
	const s =
		subtle ??
		((globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle as SubtleCrypto | undefined);
	if (!s) {
		throw new Error('EmailGateService: SubtleCrypto unavailable — env requires Web Crypto');
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


/**
 * Strip <, >, &, /, \, control chars and trim. Keeps Unicode letters
 * and common punctuation. Caps length at 40 chars (a UI hint, not a hard
 * GDPR limit). Returns undefined for empty input.
 */
function sanitizeName(input: string | undefined): string | undefined {
	if (!input) return undefined;
	const NAUGHTY = /[<>&\/\\\u0000-\u001f]/g;
	const clean = input.replace(NAUGHTY, "").trim().slice(0, 40);
	return clean.length > 0 ? clean : undefined;
}
