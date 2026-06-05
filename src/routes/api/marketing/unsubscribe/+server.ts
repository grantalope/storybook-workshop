// src/routes/api/marketing/unsubscribe/+server.ts
//
// GET (preferred): one-click unsubscribe from a per-template footer link
//   /api/marketing/unsubscribe?email=<email>&type=<bucket>&token=<hex32>
// POST: same payload via JSON body — used by the in-app unsubscribe form.
//
// Token is an HMAC-SHA256 of `${emailLower}:${bucket}` keyed by
// STORYBOOK_EMAIL_GATE_SECRET, truncated to 32 hex chars. Per spec §8.2
// + RFC 8058 the link is per-recipient; an attacker who knows or guesses
// a victim's email cannot mint a valid token without the server secret.
//
// Response 200: { ok: true, bucket, cascaded: [...] }
// Response 400: invalid bucket / missing email
// Response 401: missing or invalid HMAC token
// Response 404: unknown email (we still return 200 with ok:false to avoid
//               email-enumeration, mirroring pre-token behaviour).

import { json, type RequestHandler } from '@sveltejs/kit';
import { getMarketingDeps, getServerSecret } from '../_shared';
import { verifyUnsubToken } from '$lib/services/marketing/unsubToken';

const VALID_BUCKETS = ['transactional', 'marketing', 'educational'];

export const GET: RequestHandler = async ({ url }) => {
	const email = url.searchParams.get('email');
	const bucket = url.searchParams.get('type');
	const token = url.searchParams.get('token');
	return handle(email, bucket, token);
};

export const POST: RequestHandler = async ({ request, url }) => {
	let email = url.searchParams.get('email');
	let bucket = url.searchParams.get('type');
	let token = url.searchParams.get('token');
	if (!email || !bucket || !token) {
		try {
			const body = (await request.json()) as { email?: string; type?: string; token?: string };
			email = email ?? body.email ?? null;
			bucket = bucket ?? body.type ?? null;
			token = token ?? body.token ?? null;
		} catch {
			// fallthrough — handle() will 400/401 below
		}
	}
	return handle(email, bucket, token);
};

async function handle(email: string | null, bucket: string | null, token: string | null) {
	if (!email) return json({ error: 'missing_email' }, { status: 400 });
	if (!bucket || !VALID_BUCKETS.includes(bucket)) {
		return json({ error: 'invalid_bucket', validBuckets: VALID_BUCKETS }, { status: 400 });
	}
	if (!token) {
		return json({ error: 'missing_token' }, { status: 401 });
	}
	const secret = getServerSecret();
	const ok = await verifyUnsubToken({ email, bucket, secret, token });
	if (!ok) {
		return json({ error: 'invalid_token' }, { status: 401 });
	}
	const deps = getMarketingDeps();
	const res = deps.unsubscribe.unsubscribe(email, bucket);
	if (!res.ok) {
		// Don't 404 — that leaks email-existence. Return 200 anyway with ok:false flag.
		return json({ ok: false, bucket: res.bucket, error: res.error }, { status: 200 });
	}
	return json({ ok: true, bucket: res.bucket, cascaded: res.cascaded ?? [] });
}
