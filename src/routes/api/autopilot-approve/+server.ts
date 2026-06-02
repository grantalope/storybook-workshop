// src/routes/api/autopilot-approve/+server.ts
//
// POST: parent responds to an auto-drafted book.
// Body: { subscriptionId, draftId, action: 'approve' | 'redo' | 'swap_theme', newThemeId? }
//
// MVP stateless — production wiring needs a persistent AutopilotDrafter
// singleton tied to the subscription store. Endpoint validates the shape
// and returns the would-be effect; real persistence is follow-up.

import { json, type RequestHandler } from '@sveltejs/kit';

interface PostBody {
	subscriptionId: string;
	draftId: string;
	action: 'approve' | 'redo' | 'swap_theme';
	newThemeId?: string;
}

export const POST: RequestHandler = async ({ request }) => {
	let body: PostBody;
	try {
		body = (await request.json()) as PostBody;
	} catch {
		return json({ error: 'invalid_json' }, { status: 400 });
	}
	if (!body.subscriptionId || !body.draftId) {
		return json({ error: 'missing_subscriptionId_or_draftId' }, { status: 400 });
	}
	if (!['approve', 'redo', 'swap_theme'].includes(body.action)) {
		return json({ error: 'invalid_action' }, { status: 400 });
	}
	if (body.action === 'swap_theme' && !body.newThemeId) {
		return json({ error: 'missing_newThemeId' }, { status: 400 });
	}
	return json(
		{
			ok: true,
			subscriptionId: body.subscriptionId,
			draftId: body.draftId,
			action: body.action,
			newThemeId: body.newThemeId,
			note: 'MVP stateless — production wiring requires AutopilotDrafter persistence.',
		},
		{ status: 202 }
	);
};
