// tests/fulfillment/api-helpers.ts
//
// Minimal RequestEvent shim for SvelteKit endpoint tests. Endpoints only
// touch `params`, `request`, and the destructured handler args we forward.

import type { RequestEvent, RequestHandler } from '@sveltejs/kit';

export interface CallOpts {
	body?: unknown;
	rawBody?: string;
	headers?: Record<string, string>;
	params?: Record<string, string>;
	url?: string;
}

export async function callPost(handler: RequestHandler, opts: CallOpts = {}) {
	return callHandler(handler, 'POST', opts);
}

export async function callGet(handler: RequestHandler, opts: CallOpts = {}) {
	return callHandler(handler, 'GET', opts);
}

async function callHandler(
	handler: RequestHandler,
	method: 'GET' | 'POST',
	opts: CallOpts,
): Promise<{ status: number; data: any }> {
	const url = opts.url ?? `http://localhost/api/test`;
	const init: RequestInit = { method, headers: opts.headers ?? {} };
	if (method === 'POST') {
		init.body = opts.rawBody ?? JSON.stringify(opts.body ?? {});
		(init.headers as Record<string, string>)['content-type'] =
			(opts.headers ?? {})['content-type'] ?? 'application/json';
	}
	const req = new Request(url, init);
	const event = {
		request: req,
		params: opts.params ?? {},
		url: new URL(url),
	} as unknown as RequestEvent;
	const result = await handler(event);
	if (!result) throw new Error('handler returned undefined');
	const res = result as Response;
	let data;
	const text = await res.text();
	try {
		data = JSON.parse(text);
	} catch {
		data = text;
	}
	return { status: res.status, data };
}
