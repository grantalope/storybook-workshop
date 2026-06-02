// @graph-layer: infrastructure
// @rationale: infrastructure (kernel — layer-agnostic primitive: supervisor/ports/WAL/effects)

import type { EmbedImageRequest } from '$lib/llr';
import type { EmbeddingSurfaceLike } from './embed-text';
import type { WorkloadDescriptor, WorkloadRunContext } from '$lib/kernel-contracts/workloads';

export type { EmbeddingSurfaceLike } from './embed-text';

export interface EmbedImageAdapter {
  embedImage(req: EmbedImageRequest): Promise<Float32Array>;
}

type ScheduleWorkload = <T>(
  descriptor: WorkloadDescriptor,
  runner: (ctx: WorkloadRunContext) => Promise<T> | T,
) => Promise<T>;

export function createEmbedImageAdapter(
  getSurface: () => EmbeddingSurfaceLike | null,
  scheduleWorkload?: ScheduleWorkload,
): EmbedImageAdapter {
  return {
    async embedImage(req: EmbedImageRequest): Promise<Float32Array> {
      const run = ({ signal }: WorkloadRunContext) => {
        const s = getSurface();
        if (!s) throw new Error('LLR embedding surface not booted. Call runtime.boot() at app startup.');
        return s.embedImage({ ...req, abortSignal: req.abortSignal ?? signal });
      };
      if (!scheduleWorkload) return run({ signal: req.abortSignal ?? new AbortController().signal, descriptor: {} as any });
      return scheduleWorkload({
        kind: 'embedding',
        resource: 'gpu',
        priority: req.priority ?? 'idle',
        label: 'inference.embed-image',
        caller: 'inference.embed-image',
        signal: req.abortSignal,
        timeoutMs: req.timeoutMs,
      }, run);
    },
  };
}
