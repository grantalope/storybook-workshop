// @graph-layer: infrastructure
// @rationale: infrastructure (kernel — layer-agnostic primitive: supervisor/ports/WAL/effects)

import type { EmbedRequest, EmbedImageRequest } from '$lib/stubs/llr';
import type { WorkloadDescriptor, WorkloadRunContext } from '$lib/kernel-contracts/workloads';

export interface EmbeddingSurfaceLike {
  embed(req: EmbedRequest): Promise<Float32Array | Float32Array[]>;
  embedImage(req: EmbedImageRequest): Promise<Float32Array>;
}

export interface EmbedTextAdapter {
  embed(req: EmbedRequest): Promise<Float32Array | Float32Array[]>;
}

type ScheduleWorkload = <T>(
  descriptor: WorkloadDescriptor,
  runner: (ctx: WorkloadRunContext) => Promise<T> | T,
) => Promise<T>;

export function createEmbedTextAdapter(
  getSurface: () => EmbeddingSurfaceLike | null,
  scheduleWorkload?: ScheduleWorkload,
): EmbedTextAdapter {
  return {
    async embed(req: EmbedRequest): Promise<Float32Array | Float32Array[]> {
      const run = ({ signal }: WorkloadRunContext) => {
        const s = getSurface();
        if (!s) throw new Error('LLR embedding surface not booted. Call runtime.boot() at app startup.');
        return s.embed({ ...req, abortSignal: req.abortSignal ?? signal });
      };
      if (!scheduleWorkload) return run({ signal: req.abortSignal ?? new AbortController().signal, descriptor: {} as any });
      return scheduleWorkload({
        kind: 'embedding',
        resource: 'gpu',
        priority: req.priority ?? 'idle',
        label: 'inference.embed',
        caller: 'inference.embed',
        signal: req.abortSignal,
        timeoutMs: req.timeoutMs,
      }, run);
    },
  };
}
