/**
 * GET /api/book/[shortcode]
 *
 * Serves a Read-Along bundle to the public preview URL. Past spread index 4
 * the response is gated behind an email session cookie (per spec §8 marketing
 * funnel). When the cookie is missing/invalid, returns 401 + an `email-gate`
 * signal so the client UI can render the email-capture modal.
 *
 * Phase-8 scope is the HTTP surface contract; the marketing-funnel goal
 * (#11) lights up Resend / Postmark, the CRM write, and the session cookie
 * grant on POST email submission. v1 ships an in-memory store + a 60-min
 * cookie so the route is testable end-to-end.
 */

import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import type { DialogicPrompt } from '$lib/services/author/types';
import type { EduOverlayBundle, PhonicsMap, QuizQuestion, Tier2Annotation, WordTiming } from '$lib/services/readaloud/types';

/** Pluggable store — replaced at runtime by the fulfillment backend. */
export interface BundleStore {
	get(shortcode: string): Promise<PublicBundleSnapshot | null>;
}

export interface PublicBundleSnapshot {
	shortcode: string;
	title: string;
	stylePackId?: string;
	spreads: Array<{ index: number; text: string; framePngBase64: string; effect: string }>;
	hasVoiceOver: boolean;
	hasDedicationAudio: boolean;
	edu?: EduOverlayBundle;
}

type PublicEduOverlayBundle = Omit<EduOverlayBundle, 'quiz'> & { quiz?: QuizQuestion[] };

const EMAIL_GATE_THRESHOLD = 4; // visible up to + including spread index 4
const WORD_RE = /[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu;

let _store: BundleStore = {
	async get() {
		return null;
	}
};

export function __setStoreForTests(store: BundleStore): void {
	_store = store;
}

const EMAIL_SESSIONS = new Map<string, { email: string; ts: number }>();
const SESSION_TTL_MS = 60 * 60 * 1000;

function readSessionCookie(cookieHeader: string | null, shortcode: string): boolean {
	if (!cookieHeader) return false;
	const cookies = Object.fromEntries(
		cookieHeader
			.split(';')
			.map(c => c.trim().split('='))
			.filter(p => p.length === 2)
	);
	const key = `sw_email_gate_${shortcode}`;
	const token = cookies[key];
	if (!token) return false;
	const sess = EMAIL_SESSIONS.get(token);
	if (!sess) return false;
	if (Date.now() - sess.ts > SESSION_TTL_MS) {
		EMAIL_SESSIONS.delete(token);
		return false;
	}
	return true;
}

export function __grantEmailSession(shortcode: string, email: string): string {
	const token = (typeof crypto !== 'undefined' && (crypto as any).randomUUID)
		? (crypto as any).randomUUID()
		: 'tok_' + Math.random().toString(36).slice(2);
	EMAIL_SESSIONS.set(token, { email, ts: Date.now() });
	return token;
}

export const GET: RequestHandler = async ({ params, request }) => {
	const shortcode = params.shortcode as string | undefined;
	if (!shortcode || !/^[a-z2-9]{8}$/.test(shortcode)) {
		return json({ error: 'invalid-shortcode' }, { status: 400 });
	}
	const snap = await _store.get(shortcode);
	if (!snap) {
		return json({ error: 'not-found' }, { status: 404 });
	}
	const gated = readSessionCookie(request.headers.get('cookie'), shortcode);
	if (!gated) {
		const visibleSpreads = snap.spreads.filter(s => s.index <= EMAIL_GATE_THRESHOLD);
		const truncated = {
			...snap,
			spreads: visibleSpreads,
			edu: snap.edu ? truncateEdu(snap.edu, visibleSpreads) : undefined,
			emailGateRequired: true,
			emailGateAfter: EMAIL_GATE_THRESHOLD
		};
		return json(truncated, { status: 200 });
	}
	return json({ ...snap, emailGateRequired: false });
};

export const POST: RequestHandler = async ({ params, request }) => {
	const shortcode = params.shortcode as string | undefined;
	if (!shortcode || !/^[a-z2-9]{8}$/.test(shortcode)) {
		return json({ error: 'invalid-shortcode' }, { status: 400 });
	}
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'invalid-json' }, { status: 400 });
	}
	const email = (body as { email?: unknown }).email;
	if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
		return json({ error: 'invalid-email' }, { status: 400 });
	}
	const snap = await _store.get(shortcode);
	if (!snap) return json({ error: 'not-found' }, { status: 404 });
	const token = __grantEmailSession(shortcode, email);
	return json(
		{ ok: true, emailGateRequired: false },
		{
			status: 200,
			headers: {
				'set-cookie': `sw_email_gate_${shortcode}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`
			}
		}
	);
};

function truncateEdu(
	edu: EduOverlayBundle,
	spreads: PublicBundleSnapshot['spreads']
): PublicEduOverlayBundle {
	const visibleSpreadIndexes = new Set(spreads.map((spread) => spread.index));
	const visibleWords = wordsFromSpreads(spreads);
	const truncated: PublicEduOverlayBundle = {
		phonicsMap: filterPhonicsMap(edu.phonicsMap, visibleWords),
		tier2Annotations: filterBySpread(edu.tier2Annotations, visibleSpreadIndexes),
		dialogicPrompts: filterBySpread(edu.dialogicPrompts, visibleSpreadIndexes)
	};
	if (edu.wordTimings) {
		truncated.wordTimings = filterWordTimings(edu.wordTimings, visibleSpreadIndexes);
	}
	return truncated;
}

function wordsFromSpreads(spreads: PublicBundleSnapshot['spreads']): Set<string> {
	const words = new Set<string>();
	for (const spread of spreads) {
		for (const match of spread.text.matchAll(WORD_RE)) {
			words.add(match[0].toLocaleLowerCase('en-US'));
		}
	}
	return words;
}

function filterPhonicsMap(phonicsMap: PhonicsMap, visibleWords: Set<string>): PhonicsMap {
	return Object.fromEntries(
		Object.entries(phonicsMap).filter(([word]) => visibleWords.has(word.toLocaleLowerCase('en-US')))
	);
}

function filterBySpread<T extends Tier2Annotation | DialogicPrompt>(
	items: T[],
	visibleSpreadIndexes: Set<number>
): T[] {
	return items.filter((item) => visibleSpreadIndexes.has(item.spreadIndex));
}

function filterWordTimings(
	wordTimings: Record<number, WordTiming[]>,
	visibleSpreadIndexes: Set<number>
): Record<number, WordTiming[]> {
	return Object.fromEntries(
		Object.entries(wordTimings).filter(([spreadIndex]) => visibleSpreadIndexes.has(Number(spreadIndex)))
	);
}
