// src/routes/api/marketing/unsubscribe/+server.ts
//
// GET (preferred): one-click unsubscribe from a per-template footer link
//   /api/marketing/unsubscribe?email=<email>&type=<bucket>
// POST: same payload via JSON body — used by the in-app unsubscribe form.
//
// Response 200: { ok: true, bucket, cascaded: [...] }
// Response 400: invalid bucket / missing email
// Response 404: unknown email (still returns 200 to avoid email-enumeration)

import { json, type RequestHandler } from '@sveltejs/kit';
import { getMarketingDeps } from '../_shared';

const VALID_BUCKETS = ['transactional', 'marketing', 'educational'];

export const GET: RequestHandler = async ({ url }) => {
	const email = url.searchParams.get('email');
	const bucket = url.searchParams.get('type');
	return handle(email, bucket);
};

export const POST: RequestHandler = async ({ request, url }) => {
	let email = url.searchParams.get('email');
	let bucket = url.searchParams.get('type');
	if (!email || !bucket) {
		try {
			const body = (await request.json()) as { email?: string; type?: string };
			email = email ?? body.email ?? null;
			bucket = bucket ?? body.type ?? null;
		} catch {
			// fallthrough — handle() will 400 below
		}
	}
	return handle(email, bucket);
};

function handle(email: string | null, bucket: string | null) {
	if (!email) return json({ error: 'missing_email' }, { status: 400 });
	if (!bucket || !VALID_BUCKETS.includes(bucket)) {
		return json({ error: 'invalid_bucket', validBuckets: VALID_BUCKETS }, { status: 400 });
	}
	const deps = getMarketingDeps();
	const res = deps.unsubscribe.unsubscribe(email, bucket);
	if (!res.ok) {
		// Don't 404 — that leaks email-existence. Return 200 anyway with ok:false flag.
		return json({ ok: false, bucket: res.bucket, error: res.error }, { status: 200 });
	}
	return json({ ok: true, bucket: res.bucket, cascaded: res.cascaded ?? [] });
}
