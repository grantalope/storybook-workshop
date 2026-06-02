// @graph-layer: infrastructure
// @rationale: infrastructure (kernel — layer-agnostic primitive: supervisor/ports/WAL/effects)

/**
 * getKernel / isKernelReady — typed accessors for the global kernel handle.
 *
 * Replaces the `(globalThis as any).__kernel` pattern scattered across
 * ~30 migration helpers. Shape-validates the handle so callers never
 * get a stub object that lacks `connect`.
 */

import type { KernelLike } from './define-kernel-mirror';

function _shapeCheck(v: unknown): v is KernelLike {
  return (
    v !== null &&
    typeof v === 'object' &&
    typeof (v as any).connect === 'function'
  );
}

/**
 * Returns the global kernel handle if it passes the shape check,
 * null otherwise.
 */
export function getKernel(): KernelLike | null {
  const v = (globalThis as any).__kernel;
  return _shapeCheck(v) ? (v as KernelLike) : null;
}

/**
 * Returns true when a kernel is available AND ready to handle calls.
 * Back-compat: when the kernel has no `isReady` method, treats it as ready.
 */
export function isKernelReady(): boolean {
  const k = getKernel();
  if (!k) return false;
  return typeof k.isReady === 'function' ? k.isReady() : true;
}
