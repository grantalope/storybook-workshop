// @graph-layer: private
// @rationale: private (parent-email side-effect surface — billing PII tier)
//
// src/lib/services/fulfillment/TransactionalEmailProvider.ts
//
// Transactional email provider interface + 3 concrete implementations:
//   - NoopEmailProvider:    no-op; default for tests + dev.
//   - LoggingEmailProvider: captures messages in memory; default for the
//                           in-process server until a real provider is
//                           configured (so ops can replay if needed).
//   - ResendEmailProvider:  sketch — uses fetch + Resend REST API.
//   - PostmarkEmailProvider: sketch — uses fetch + Postmark REST API.
//
// Real provider implementations are minimal — they construct the HTTP
// request shape. The wire-up to a transactional email vendor is goal #11
// (marketing-funnel) territory. The interface lives here so the lifecycle
// service can fire events without knowing which vendor is live.

import type { EmailMessage, TransactionalEmailProvider } from './types';

export class NoopEmailProvider implements TransactionalEmailProvider {
	async send(_msg: EmailMessage): Promise<void> {
		// no-op
	}
}

export class LoggingEmailProvider implements TransactionalEmailProvider {
	public readonly messages: EmailMessage[] = [];
	async send(msg: EmailMessage): Promise<void> {
		this.messages.push(msg);
	}
}

export interface ResendEmailProviderOpts {
	apiKey: string;
	from: string;
	fetchImpl?: typeof fetch;
}

export class ResendEmailProvider implements TransactionalEmailProvider {
	constructor(private opts: ResendEmailProviderOpts) {}
	async send(msg: EmailMessage): Promise<void> {
		const fetchImpl = this.opts.fetchImpl ?? fetch;
		const body = JSON.stringify({
			from: this.opts.from,
			to: msg.to,
			subject: subjectFor(msg.event, msg.order.id),
			text: textFor(msg),
		});
		await fetchImpl('https://api.resend.com/emails', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${this.opts.apiKey}`,
				'Content-Type': 'application/json',
			},
			body,
		});
	}
}

export interface PostmarkEmailProviderOpts {
	serverToken: string;
	from: string;
	fetchImpl?: typeof fetch;
}

export class PostmarkEmailProvider implements TransactionalEmailProvider {
	constructor(private opts: PostmarkEmailProviderOpts) {}
	async send(msg: EmailMessage): Promise<void> {
		const fetchImpl = this.opts.fetchImpl ?? fetch;
		const body = JSON.stringify({
			From: this.opts.from,
			To: msg.to,
			Subject: subjectFor(msg.event, msg.order.id),
			TextBody: textFor(msg),
			MessageStream: 'outbound',
		});
		await fetchImpl('https://api.postmarkapp.com/email', {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				'X-Postmark-Server-Token': this.opts.serverToken,
			},
			body,
		});
	}
}

function subjectFor(event: EmailMessage['event'], orderId: string): string {
	switch (event) {
		case 'paid': return `Your storybook order ${orderId} is confirmed!`;
		case 'printed': return `Your storybook is being printed`;
		case 'shipped': return `Your storybook is on its way!`;
		case 'delivered': return `Your storybook has arrived`;
		case 'failed': return `There was a problem with your order ${orderId}`;
		case 'refunded': return `Your refund for order ${orderId} has been issued`;
	}
}

function textFor(msg: EmailMessage): string {
	const { event, order } = msg;
	switch (event) {
		case 'paid':
			return `Thanks! We have your order ${order.id}. The book is on the press soon.`;
		case 'printed':
			return `Order ${order.id} is in production at our print partner.`;
		case 'shipped':
			return `Order ${order.id} shipped. Tracking: ${order.trackingUrl ?? '(pending)'}`;
		case 'delivered':
			return `Order ${order.id} delivered. We hope ${order.kidId} loves it.`;
		case 'failed':
			return `Sorry — there was an issue with order ${order.id}. Our team is on it.`;
		case 'refunded':
			return `A refund has been issued for order ${order.id}.`;
	}
}
