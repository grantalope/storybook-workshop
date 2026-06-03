// @graph-layer: private
// @rationale: private (audit trail of state transitions; parent-visible status JSON)
//
// src/lib/services/fulfillment/OrderAuditService.ts
//
// Read-only view over an order's transition log + a parent-visible status
// JSON projection. The lifecycle service is the writer; this service is the
// reader/projection for UI + ops dashboards + customer-service prefill.
//
// Spec: docs/specs/2026-05-24-design.md §5.3 + §5.8

import type { Order, OrderState, OrderStore, TransitionLogEntry } from './types';

export interface OrderStatusProjection {
	id: string;
	state: OrderState;
	createdAt: number;
	updatedAt: number;
	trackingUrl?: string;
	transitions: TransitionLogEntry[];
	parentEmail: string;
	format: Order['format'];
	pages: number;
}

export interface OrderAuditOpts {
	store: OrderStore;
}

export class OrderAuditService {
	private _store: OrderStore;

	constructor(opts: OrderAuditOpts) {
		this._store = opts.store;
	}

	async getStatus(orderId: string): Promise<OrderStatusProjection | undefined> {
		const o = await this._store.get(orderId);
		if (!o) return undefined;
		return {
			id: o.id,
			state: o.state,
			createdAt: o.createdAt,
			updatedAt: o.updatedAt,
			trackingUrl: o.trackingUrl,
			transitions: o.transitions,
			parentEmail: o.parentEmail,
			format: o.format,
			pages: o.pages,
		};
	}

	async getTransitions(orderId: string): Promise<TransitionLogEntry[]> {
		const o = await this._store.get(orderId);
		return o?.transitions ?? [];
	}

	/** Prefill for `hello@<product>.com` contact form per spec §5.8. */
	async customerServicePrefill(orderId: string): Promise<{
		orderId: string;
		summary: string;
		lastEntries: TransitionLogEntry[];
	} | undefined> {
		const o = await this._store.get(orderId);
		if (!o) return undefined;
		const last = o.transitions.slice(-10);
		const summary = `Order ${o.id} [${o.state}] kid=${o.kidId} format=${o.format} pages=${o.pages}`;
		return { orderId: o.id, summary, lastEntries: last };
	}
}
