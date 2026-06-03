// @graph-layer: private
// @rationale: private (per-order state machine + audit log)
//
// src/lib/services/fulfillment/OrderLifecycleService.ts
//
// Order state machine + persistence + per-transition side-effects. The
// canonical authority on what state an order is in, who put it there, when,
// and why. Allowed transitions are enforced — illegal transitions throw
// `OrderLifecycleError` rather than silently corrupting state.
//
// Side-effects are kept declarative (handler callbacks) so this service
// stays testable in isolation. The default wiring in production hooks the
// `paid` -> Lulu print-job-submit path and the email triggers.
//
// Spec: docs/specs/2026-05-24-design.md §5.3 + §5.4 + §5.5

import type {
	ConsentLogEntry,
	Order,
	OrderState,
	OrderStore,
	TransitionActor,
	TransitionLogEntry,
	ShippingAddress,
	ShippingOption,
} from './types';
import { DEFAULT_CANCEL_WINDOW_MS } from './types';
import type { BookFormat } from '$lib/services/assemble/types';

export class OrderLifecycleError extends Error {
	constructor(public readonly reason: string) {
		super(`OrderLifecycle: ${reason}`);
		this.name = 'OrderLifecycleError';
	}
}

/**
 * Adjacency map of allowed transitions per spec §5.3 + §5.5 branches.
 * Every key is an OrderState; values are the set of states reachable from it.
 */
const ALLOWED: Record<OrderState, ReadonlySet<OrderState>> = Object.freeze({
	pending_payment: new Set<OrderState>([
		'paid',
		'failed_validation',
		'cancelled_pre_production',
	]),
	paid: new Set<OrderState>([
		'submitted_to_lulu',
		'lulu_error_recoverable',
		'lulu_error_terminal',
		'cancelled_pre_production',
	]),
	submitted_to_lulu: new Set<OrderState>([
		'in_production',
		'shipped',
		'cancelled_pre_production',
		'lulu_error_recoverable',
		'lulu_error_terminal',
	]),
	in_production: new Set<OrderState>([
		'shipped',
		'lulu_error_recoverable',
		'lulu_error_terminal',
	]),
	shipped: new Set<OrderState>(['delivered', 'lost_in_transit']),
	delivered: new Set<OrderState>([]),
	cancelled_pre_production: new Set<OrderState>([]),
	failed_validation: new Set<OrderState>([]),
	lulu_error_recoverable: new Set<OrderState>([
		'submitted_to_lulu',
		'lulu_error_terminal',
		'cancelled_pre_production',
	]),
	lulu_error_terminal: new Set<OrderState>([]),
	lost_in_transit: new Set<OrderState>([]),
});

export interface CreateOrderOpts {
	id: string;
	kidId: string;
	bookId: string;
	parentEmail: string;
	format: BookFormat;
	pages: number;
	pdfHash: string;
	shippingAddress: ShippingAddress;
	shippingOption: ShippingOption;
	bookCostCents: number;
	consentLog: ConsentLogEntry;
}

/** Side-effect callbacks fired by `transition()` after a successful state change. */
export interface LifecycleHandlers {
	onPaid?: (order: Order) => Promise<void> | void;
	onSubmitted?: (order: Order) => Promise<void> | void;
	onInProduction?: (order: Order) => Promise<void> | void;
	onShipped?: (order: Order) => Promise<void> | void;
	onDelivered?: (order: Order) => Promise<void> | void;
	onCancelled?: (order: Order) => Promise<void> | void;
	onFailed?: (order: Order) => Promise<void> | void;
	onRecoverableError?: (order: Order) => Promise<void> | void;
	onTerminalError?: (order: Order) => Promise<void> | void;
	onLost?: (order: Order) => Promise<void> | void;
}

export interface OrderLifecycleOpts {
	store: OrderStore;
	handlers?: LifecycleHandlers;
	nowSource?: () => number;
	cancelWindowMs?: number;
}

export class OrderLifecycleService {
	private _store: OrderStore;
	private _handlers: LifecycleHandlers;
	private _now: () => number;
	private _cancelWindowMs: number;

	constructor(opts: OrderLifecycleOpts) {
		this._store = opts.store;
		this._handlers = opts.handlers ?? {};
		this._now = opts.nowSource ?? (() => Date.now());
		this._cancelWindowMs = opts.cancelWindowMs ?? DEFAULT_CANCEL_WINDOW_MS;
	}

	/** Create a new order in `pending_payment`. */
	async create(opts: CreateOrderOpts): Promise<Order> {
		const now = this._now();
		const order: Order = {
			id: opts.id,
			kidId: opts.kidId,
			bookId: opts.bookId,
			parentEmail: opts.parentEmail,
			format: opts.format,
			pages: opts.pages,
			pdfHash: opts.pdfHash,
			shippingAddress: opts.shippingAddress,
			shippingOption: opts.shippingOption,
			bookCostCents: opts.bookCostCents,
			state: 'pending_payment',
			transitions: [
				{
					from: null,
					to: 'pending_payment',
					at: now,
					actor: 'system',
					reason: 'order_created',
				},
			],
			consentLog: opts.consentLog,
			createdAt: now,
			updatedAt: now,
		};
		await this._store.put(order);
		return order;
	}

	async get(id: string): Promise<Order | undefined> {
		return this._store.get(id);
	}

	/**
	 * Apply a transition. Throws OrderLifecycleError if not allowed.
	 * Fires the matching handler after persistence so a handler failure does
	 * not leave the in-memory state ahead of the store.
	 */
	async transition(
		orderId: string,
		to: OrderState,
		actor: TransitionActor,
		opts?: { reason?: string; meta?: Record<string, unknown>; patch?: Partial<Order> },
	): Promise<Order> {
		const order = await this._store.get(orderId);
		if (!order) throw new OrderLifecycleError(`order ${orderId} not found`);
		const from = order.state;
		if (!ALLOWED[from].has(to)) {
			throw new OrderLifecycleError(`transition not allowed: ${from} -> ${to}`);
		}
		const at = this._now();
		const entry: TransitionLogEntry = {
			from,
			to,
			at,
			actor,
			reason: opts?.reason,
			meta: opts?.meta,
		};
		const next: Order = {
			...order,
			...(opts?.patch ?? {}),
			state: to,
			transitions: [...order.transitions, entry],
			updatedAt: at,
		};
		await this._store.put(next);
		await this._fireHandler(to, next);
		return next;
	}

	/**
	 * Cancel inside the parent-facing window. Spec §5.4: window is 60-90 min
	 * post-submission; we use 75min by default. Returns the updated order.
	 * Throws with `past_cancel_window` reason if outside the window.
	 */
	async cancelByParent(orderId: string): Promise<Order> {
		const order = await this._store.get(orderId);
		if (!order) throw new OrderLifecycleError(`order ${orderId} not found`);
		if (order.state === 'pending_payment') {
			// Pre-payment cancel always allowed.
			return this.transition(orderId, 'cancelled_pre_production', 'parent', {
				reason: 'parent_cancel_pre_payment',
			});
		}
		if (order.state !== 'submitted_to_lulu') {
			throw new OrderLifecycleError('past_cancel_window');
		}
		const submittedAt = lastTransitionAt(order, 'submitted_to_lulu');
		const elapsed = this._now() - (submittedAt ?? 0);
		if (elapsed > this._cancelWindowMs) {
			throw new OrderLifecycleError('past_cancel_window');
		}
		return this.transition(orderId, 'cancelled_pre_production', 'parent', {
			reason: 'parent_cancel_within_window',
		});
	}

	/** Helpers reused by API endpoints. */
	isPastCancelWindow(order: Order): boolean {
		if (order.state === 'pending_payment') return false;
		if (order.state !== 'submitted_to_lulu') return true;
		const submittedAt = lastTransitionAt(order, 'submitted_to_lulu');
		if (submittedAt === null) return true;
		return this._now() - submittedAt > this._cancelWindowMs;
	}

	async _fireHandler(state: OrderState, order: Order): Promise<void> {
		const h = this._handlers;
		switch (state) {
			case 'paid':
				await h.onPaid?.(order);
				break;
			case 'submitted_to_lulu':
				await h.onSubmitted?.(order);
				break;
			case 'in_production':
				await h.onInProduction?.(order);
				break;
			case 'shipped':
				await h.onShipped?.(order);
				break;
			case 'delivered':
				await h.onDelivered?.(order);
				break;
			case 'cancelled_pre_production':
				await h.onCancelled?.(order);
				break;
			case 'failed_validation':
				await h.onFailed?.(order);
				break;
			case 'lulu_error_recoverable':
				await h.onRecoverableError?.(order);
				break;
			case 'lulu_error_terminal':
				await h.onTerminalError?.(order);
				break;
			case 'lost_in_transit':
				await h.onLost?.(order);
				break;
			default:
				break;
		}
	}
}

function lastTransitionAt(order: Order, to: OrderState): number | null {
	for (let i = order.transitions.length - 1; i >= 0; i--) {
		if (order.transitions[i].to === to) return order.transitions[i].at;
	}
	return null;
}

// ---------------------------------------------------------------------------
// In-memory OrderStore implementation (browser + tests)
// ---------------------------------------------------------------------------

export class InMemoryOrderStore implements OrderStore {
	private _map = new Map<string, Order>();

	async get(id: string): Promise<Order | undefined> {
		return this._map.get(id);
	}
	async put(order: Order): Promise<void> {
		this._map.set(order.id, { ...order });
	}
	async listByParent(email: string): Promise<Order[]> {
		const out: Order[] = [];
		for (const o of this._map.values()) if (o.parentEmail === email) out.push(o);
		return out;
	}
	async getByStripePaymentIntent(id: string): Promise<Order | undefined> {
		for (const o of this._map.values()) if (o.stripePaymentIntentId === id) return o;
		return undefined;
	}
	async getByLuluJob(id: string): Promise<Order | undefined> {
		for (const o of this._map.values()) if (o.luluJobId === id) return o;
		return undefined;
	}
	/** Test/debug helper. */
	_all(): Order[] {
		return [...this._map.values()];
	}
}
