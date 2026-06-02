// src/routes/api/subscribe/[id]/+server.ts
//
// GET: subscription status.
// POST: { action: 'skip' | 'cancel' | 'pause' | 'resume' }.
//
// MVP: per-request stateless. Production wiring needs a backend store
// (likely Postgres) — flagged in implementation-notes.md.

import { json, type RequestHandler } from '@sveltejs/kit';

type Action = 'skip' | 'cancel' | 'pause' | 'resume';

interface PostBody {
	action: Action;
}

export const GET: RequestHandler = async () => {
	// MVP: no persistence — return a 501 to make the lack of state explicit
	// rather than silently lying with empty data.
	return json(
		{
			error: 'not_implemented',
			message:
				'Subscription state is not persisted in MVP — production wiring requires a backend store (see implementation-notes.md).',
		},
		{ status: 501 }
	);
};

export const POST: RequestHandler = async ({ request, params }) => {
	const id = params.id;
	if (!id) return json({ error: 'missing_id' }, { status: 400 });
	let body: PostBody;
	try {
		body = (await request.json()) as PostBody;
	} catch {
		return json({ error: 'invalid_json' }, { status: 400 });
	}
	if (!['skip', 'cancel', 'pause', 'resume'].includes(body.action)) {
		return json({ error: 'invalid_action' }, { status: 400 });
	}
	// MVP: stateless — surface what would be done without a store
	return json(
		{
			ok: true,
			action: body.action,
			subscriptionId: id,
			note: 'MVP stateless — production wiring requires a backend store.',
		},
		{ status: 202 }
	);
};
