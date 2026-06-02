// @graph-layer: infrastructure
// @rationale: infrastructure (kernel — layer-agnostic primitive: supervisor/ports/WAL/effects)

import type {
  WorkloadCost,
  WorkloadKind,
  WorkloadPriority,
  WorkloadRequest,
  WorkloadTicket,
} from '$lib/kernel-contracts/workers/adaptive-workload-manager';
import type { Priority } from '$lib/llr';

export interface KernelWorkloadScheduler {
  scheduleWorkload<T>(request: WorkloadRequest<T>): WorkloadTicket<T>;
}

export interface ScheduledInferenceRequest {
  id?: string;
  kind: WorkloadKind;
  priority?: Priority | WorkloadPriority;
  cost?: WorkloadCost;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export function scheduleInference<T>(
  scheduler: KernelWorkloadScheduler | null | undefined,
  request: ScheduledInferenceRequest,
  run: () => T | Promise<T>,
): Promise<T> {
  if (!scheduler || typeof scheduler.scheduleWorkload !== 'function') {
    return Promise.resolve().then(run);
  }
  return scheduler.scheduleWorkload<T>({
    id: request.id,
    kind: request.kind,
    priority: mapWorkloadPriority(request.priority),
    cost: request.cost,
    timeoutMs: request.timeoutMs,
    signal: request.signal,
    run,
  }).promise;
}

export function mapWorkloadPriority(priority: Priority | WorkloadPriority | undefined): WorkloadPriority {
  if (priority === 'critical') return 'critical';
  if (priority === 'idle') return 'idle';
  if (priority === 'foreground' || priority === 'background') return priority;
  return 'foreground';
}
