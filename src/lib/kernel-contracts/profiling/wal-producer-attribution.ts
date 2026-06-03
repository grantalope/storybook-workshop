// Stub for standalone storybook-workshop repo. WAL producer attribution is a
// pachinko-kernel-internal profiling/telemetry surface; the storybook subsystem
// only references it via define-kernel-mirror.recordProducerEvent for
// fire-and-forget observability. No-op here.

export interface ProducerEvent {
	readonly capName?: string;
	readonly methodName?: string;
	readonly callerName?: string;
	readonly producerName?: string;
	readonly ts?: number;
	readonly latencyMs?: number;
	readonly error?: unknown;
}

export function recordProducerEvent(_evt: ProducerEvent): void {
	// no-op in standalone
}
