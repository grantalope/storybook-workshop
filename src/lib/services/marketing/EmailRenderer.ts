// @graph-layer: private
// @rationale: private (rendering parent-targeted email body — billing PII tier)
//
// src/lib/services/marketing/EmailRenderer.ts
//
// Per-template HTML + plain-text generation. Returns BOTH text and html
// for every template so transactional providers can pick. Plain-text is
// the authoritative source for body copy; HTML is a wrapping layer.
//
// Templates intentionally avoid kid photo / book interior. Only the
// shareable-link `link` variable transports the read-along surface.
//
// Spec: docs/specs/2026-05-24-design.md §8.2 + §8.7

import type { EmailTemplate } from './types';
import { subjectFor, textFor, footerFor } from './CrmClient';

export interface RenderedEmail {
	subject: string;
	text: string;
	html: string;
}

export interface RenderEmailOpts {
	template: EmailTemplate;
	to: string;
	vars?: Record<string, string>;
}

/**
 * Produce a fully-rendered email payload.  Plain-text falls back to the
 * canonical `textFor` from CrmClient. HTML wraps the body in a minimal
 * accessible template with a visible unsubscribe link.
 */
export function renderEmail(opts: RenderEmailOpts): RenderedEmail {
	const vars: Record<string, string> = { ...(opts.vars ?? {}), to_email: opts.to };
	const subject = subjectFor(opts.template, vars);
	const text = textFor(opts.template, vars);
	const html = htmlFor(opts.template, vars, text);
	return { subject, text, html };
}

function htmlFor(
	template: EmailTemplate,
	vars: Record<string, string>,
	plainText: string,
): string {
	const safeName = escapeHtml(vars.kid_name ?? 'your kid');
	const safeLink = escapeHtml(vars.link ?? '#');
	const safePromo = vars.promo_code ? escapeHtml(vars.promo_code) : '';
	const footer = escapeHtml(footerFor(vars))
		.split('\n')
		.map((line) => `<div>${line}</div>`)
		.join('');
	const body = paragraphsFromText(plainText.split('\n\n---\n')[0] ?? '');

	const header = `<h1 style="font-family:system-ui,sans-serif;font-size:20px;line-height:1.3;margin:0 0 16px;">${escapeHtml(
		subjectFor(template, vars),
	)}</h1>`;

	const cta =
		vars.link &&
		template !== 'lifecycle_T30d' &&
		template !== 'birthday_6w' &&
		template !== 'edu_drip_weekly'
			? `<p style="margin:24px 0;"><a href="${safeLink}" style="display:inline-block;padding:12px 24px;background:#1a73e8;color:#fff;text-decoration:none;border-radius:6px;">Open ${safeName}'s book</a></p>`
			: '';

	const promoBlock = safePromo
		? `<p style="margin:12px 0;padding:12px;background:#fff8e1;border-left:4px solid #fbbc04;font-family:monospace;">Code: <strong>${safePromo}</strong></p>`
		: '';

	const unsubBucket = escapeHtml(vars.unsubscribe_bucket ?? 'marketing');
	const unsubBase = vars.unsubscribe_base ?? '/api/marketing/unsubscribe';
	const unsubLink = `${unsubBase}?email=${encodeURIComponent(vars.to_email ?? '')}&type=${unsubBucket}`;
	const visibleUnsub = `<p style="margin:24px 0 0;font-size:11px;color:#666;"><a href="${escapeHtml(
		unsubLink,
	)}" data-unsubscribe="${unsubBucket}">Unsubscribe from ${unsubBucket} emails</a></p>`;

	return [
		`<!doctype html>`,
		`<html><head><meta charset="utf-8"><title>${escapeHtml(subjectFor(template, vars))}</title></head>`,
		`<body style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:560px;margin:0 auto;padding:24px;">`,
		header,
		body,
		promoBlock,
		cta,
		visibleUnsub,
		`<hr style="border:0;border-top:1px solid #e0e0e0;margin:24px 0;">`,
		`<div style="font-size:11px;color:#888;">${footer}</div>`,
		`</body></html>`,
	].join('');
}

function paragraphsFromText(s: string): string {
	return s
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => `<p style="margin:8px 0;">${escapeHtml(line)}</p>`)
		.join('');
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}
