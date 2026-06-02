// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

// services/render/RendererKernelBridge.ts
//
// Stage 4d kernel migration — single helper for the three legacy renderer
// consumers (AsciiSceneRenderer, CompositorOverlay, PretextCompositor).
//
// Why a helper instead of importing FrameBudgetTracker directly:
//  - The kernel owns the FrameBudgetTracker singleton + the WebGPUDeviceCoordinator
//    (`render.frame-budget` and `render.device` capabilities).
//  - Direct imports of `$kernel/render` couple renderer modules to the kernel
//    internals AND skip the cap allowlist gate (`requirableBy` enforcement).
//  - The Stage 17 helper pattern says: gate on `kernel.isReady()`; pre-boot
//    calls fall through to a direct path; post-boot kernel-route failures
//    fall through with a `console.warn` so cap-registration bugs surface.
//
// Usage from a renderer:
//
//   import { measureRendererFrame } from '$services/render/RendererKernelBridge';
//   const cells = await measureRendererFrame('ascii-scene-renderer', 'render-scene-frame',
//     async () => renderSceneFrame(state, payload, time));
//
// The helper:
//  - Pre-boot OR kernel-absent → runs `fn()` directly. No kernel cost.
//  - Post-boot → routes the timing through `render.frame-budget`. The renderer's
//    per-frame durations appear in `/debug/os`.
//  - Transient connect/measure failures → warns once, then falls through to
//    direct execution (so a broken cap can't crash the renderer).
//
// WebGPU device access is exposed through `getRendererDevicePort()` for
// renderers that genuinely need a `GPUDevice` (none of the three migrated here
// do today — they're Canvas2D / CPU compute). The accessor exists so future
// WebGPU consumers route through `render.device` instead of touching
// `navigator.gpu` directly.

import { getKernel } from '$lib/kernel-contracts/helpers/get-kernel';

/** Names registered in render.frame-budget and render.device `requirableBy`. */
export type RendererCaller =
  | 'ascii-scene-renderer'
  | 'compositor-overlay'
  | 'pretext-compositor';

/** Subset of the `render.frame-budget` capability methods we consume. */
export interface RendererFrameBudgetPort {
  measure: <T>(label: string, fn: () => T | Promise<T>) => Promise<T>;
  p95: () => Promise<number>;
  overBudget: (ms: number) => Promise<number>;
  recent: (n: number) => Promise<Array<{ ts: number; durationMs: number; label?: string }>>;
  clear: () => Promise<void>;
}

/** Subset of the `render.device` capability methods we consume. */
export interface RendererDevicePort {
  /** Returns the live WebGPU device handle. May throw if not ready. */
  getDevice: () => unknown;
  /** Current coordinator state: 'acquiring' | 'ready' | 'lost' | 'recovering'. */
  state: () => string;
  /** Force re-acquire after a `lost` event. */
  recover: () => Promise<unknown>;
  /** Register a callback for device-lost events. Returns an unsubscribe fn. */
  onLost: (cb: (info: unknown) => void) => () => void;
  /** Register a callback for recovery events. Returns an unsubscribe fn. */
  onRecovered: (cb: (device: unknown) => void) => () => void;
}

/** Cache of connected ports keyed by caller. Avoids re-connecting on every frame. */
const _portCache = new Map<RendererCaller, RendererFrameBudgetPort | null>();
const _deviceCache = new Map<RendererCaller, RendererDevicePort | null>();
const _warned = new Set<string>();

function _warnOnce(key: string, msg: string, err?: unknown): void {
  if (_warned.has(key)) return;
  _warned.add(key);
  if (err !== undefined) console.warn(msg, err);
  else console.warn(msg);
}

/**
 * Kernel-ready predicate. Matches Stage 17 helper shape: not-just-present,
 * actually-ready. Pre-boot calls go to the direct path.
 */
function _kernelReady(): boolean {
  const k = getKernel();
  if (!k) return false;
  return typeof k.isReady === 'function' ? k.isReady() : true;
}

/**
 * Lazily resolve the frame-budget port for a caller. Cached after first connect.
 * Returns null when the kernel isn't ready or the connect fails (any reason).
 */
async function _ensureFrameBudgetPort(
  caller: RendererCaller,
): Promise<RendererFrameBudgetPort | null> {
  if (_portCache.has(caller)) return _portCache.get(caller) ?? null;
  if (!_kernelReady()) return null;
  const k = getKernel();
  if (!k) return null;
  try {
    const port = (await k.connect(
      'render.frame-budget',
      caller,
    )) as RendererFrameBudgetPort;
    _portCache.set(caller, port);
    return port;
  } catch (err) {
    _warnOnce(
      `frame-budget-connect:${caller}`,
      `[${caller}] kernel.connect('render.frame-budget') failed — direct path:`,
      err,
    );
    _portCache.set(caller, null);
    return null;
  }
}

/**
 * Wrap a frame's work in kernel-mediated timing. Pre-boot or no-kernel runs
 * `fn()` directly with zero overhead. Post-boot routes the timing through
 * `render.frame-budget` so `/debug/os` sees the renderer's frame durations.
 *
 * Async by design: synchronous renderers can `await measureRendererFrame(...)`
 * and the kernel measure() resolves with the result.
 */
export async function measureRendererFrame<T>(
  caller: RendererCaller,
  label: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  const port = await _ensureFrameBudgetPort(caller);
  if (!port) {
    // Direct path — pre-boot, no kernel, or connect failed earlier.
    return await fn();
  }
  try {
    return await port.measure(label, fn);
  } catch (err) {
    // Cap-level failure — warn once and fall back so the frame doesn't drop.
    _warnOnce(
      `frame-budget-measure:${caller}`,
      `[${caller}] render.frame-budget.measure failed — direct path:`,
      err,
    );
    return await fn();
  }
}

/**
 * Resolve the kernel-mediated WebGPU device port. Returns null when the
 * kernel isn't ready or the coordinator process crashed (which happens
 * legitimately on devices without WebGPU). Callers must handle null by
 * either skipping the WebGPU path or falling back to Canvas2D.
 *
 * None of the three Stage-4d-migrated renderers currently need the device
 * (CompositorOverlay = Canvas2D, AsciiSceneRenderer = CPU compute,
 * PretextCompositor = CPU layout). The accessor exists so future WebGPU
 * consumers route through `render.device` instead of `navigator.gpu` directly.
 */
export async function getRendererDevicePort(
  caller: RendererCaller,
): Promise<RendererDevicePort | null> {
  if (_deviceCache.has(caller)) return _deviceCache.get(caller) ?? null;
  if (!_kernelReady()) return null;
  const k = getKernel();
  if (!k) return null;
  try {
    const port = (await k.connect('render.device', caller)) as RendererDevicePort;
    _deviceCache.set(caller, port);
    return port;
  } catch (err) {
    _warnOnce(
      `device-connect:${caller}`,
      `[${caller}] kernel.connect('render.device') failed — direct path:`,
      err,
    );
    _deviceCache.set(caller, null);
    return null;
  }
}

/**
 * Test-only: drop the cached ports so a fresh kernel can be probed.
 * Vitest tests call this in `beforeEach`.
 */
export function _resetRendererKernelBridgeForTests(): void {
  _portCache.clear();
  _deviceCache.clear();
  _warned.clear();
}
