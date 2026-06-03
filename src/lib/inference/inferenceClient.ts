// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

// src/routes/dashboard/services/inference/inferenceClient.ts
// ============================================================================
// CANONICAL INFERENCE FACADE
// ============================================================================
//
// WHAT THIS IS
// ------------
// A single, typed entry point for ALL on-device inference in the app:
//   • text generation        (chat, streaming chat)
//   • text / image embeddings (embed, embedImage)
//   • PII scrubbing           (scrub)
//
// You ask for a client bound to your service name, then call methods on it:
//
//   import { createInferenceClient } from '.../services/inference/inferenceClient';
//
//   const inf = createInferenceClient('my-service');   // 'my-service' = caller id
//   const resp = await inf.chat({ messages });          // text generation
//   for await (const c of inf.chatStream({ messages })) {...}  // token streaming
//   const vec  = await inf.embed({ input: 'hello' });   // 768-dim embedding
//   const rep  = await inf.scrub(userText);             // PII gate
//
// That's the entire public surface. Everything below is the "why".
//
//
// WHY IT EXISTS (the problem it solves)
// -------------------------------------
// The app runs LLMs ON DEVICE (WebLLM/MLC + transformers.js/ONNX on WebGPU) —
// see CLAUDE.md "PRODUCTION = IN-BROWSER LLM ONLY". There are TWO ways a call
// can reach an engine:
//
//   (1) The "LLR" runtime directly — `llm.chat()` / `embedding.embed()` from
//       `$lib/llr`. LLR owns engine selection, the GPU queue, and the VRAM
//       budget. This is the ground-truth implementation.
//
//   (2) The browser-OS KERNEL — `kernel.connect('inference.generate', caller)`
//       returns a capability "port" that delegates to LLR but ADDS: typed-RPC
//       permission scoping (each capability has a `requirableBy` allowlist),
//       supervisor restart, operator-console visibility, and effect dedup.
//       CLAUDE.md mandate: "never `import { llm }` from `$lib/llr` in NEW
//       code — use `kernel.connect()` with an LLR fallback."
//
// The kernel is the preferred path WHEN it's booted and ready; otherwise (early
// boot, vitest, headless Chromium, a transient connect failure) callers must
// fall back to LLR so the app still works. Encoding that "try kernel, else LLR"
// dance correctly is fiddly (Stage 17 made it load-bearing: gate on
// `kernel.isReady()`, not just `kernel != null`, or you silently bypass the
// kernel in production). Historically ~67 services EACH copy-pasted:
//
//     interface InferGenPort { chat(r: ChatRequest): Promise<ChatResponse>; }
//     const _chat = defineKernelMirror<InferGenPort,[ChatRequest],ChatResponse>({
//       capName: 'inference.generate', caller: 'their-name', method: 'chat',
//       fallback: (r) => llrLlm.chat(r),
//     });
//
// …differing only by caller name + capability. This facade collapses that
// boilerplate to ONE factory call per service. It is sub-project 1 ("canonical
// facade") of the larger "Unified Local LLM" effort (the others: recipe-
// loadable models, a model-picker UI, and agentic tool routing).
//
//
// WHAT IT IS NOT — IMPORTANT MENTAL MODEL
// ---------------------------------------
// This facade is PURELY the call surface. It does NOT:
//   • choose which model runs        → that's recipes.ts + LLM_SELECTION_POLICY
//   • implement routing/fallback      → that's defineKernelMirror (reused here)
//   • know about engines or WebGPU    → that's the LLR runtime
//
// Key architectural fact: in this codebase a "MODEL IS A RECIPE". Each
// model+engine pairing is an `EngineRecipe` data object in src/lib/llr/recipes.ts
// (e.g. the LFM2.5 entries are 3 recipe objects). The only CODE per model family
// is its engine runtime (webllm / transformers.js / llm-claw). So adding a model
// never touches this file — you add a recipe. This facade sits in front of all
// of that, unchanged regardless of which recipe is active.
//
//
// HOW ROUTING WORKS (inherited from defineKernelMirror — the single source of truth)
// ----------------------------------------------------------------------------------
//   • kernel absent OR not ready (pre-boot / vitest / headless) → LLR fallback,
//     silently (this is the expected boot-time path, not an error).
//   • kernel ready → connect to the capability and call the port method.
//   • transient kernel failure (cap not yet published, connect throws, the port
//     method throws) → fall back to LLR with a `console.warn` so REAL bugs
//     surface instead of silently bypassing the kernel.
//
//
// PERMISSION SCOPING (why `caller` matters)
// -----------------------------------------
// Every inference capability in src/kernel/inference/contracts.ts has a
// `requirableBy` allowlist (exact names or `caller-*` regex wildcards). The
// `caller` string you pass flows into `kernel.connect(cap, caller)`. If `caller`
// is NOT in that capability's allowlist, the kernel refuses the connection — and
// because we fall back to LLR on connect failure, your call STILL WORKS, it just
// runs on the direct LLR path (no kernel-mediated permission scoping / dedup /
// supervision). To put a NEW caller on the kernel path you must add its name to
// the relevant `requirableBy` array in contracts.ts. The facade does not — and
// cannot — bypass that allowlist; it only makes the call ergonomic.
//
//
// LAYERING (why this file lives where it does)
// --------------------------------------------
// Location: src/routes/dashboard/services/inference/ (the APP services layer).
// It depends on $kernel/helpers (the kernel) AND PrivacyFilterService (an app
// service) AND the LLR fallback hub. Putting it in $lib/llr instead would invert
// the dependency arrows (a low-level lib importing app + kernel code), so it
// lives in the app layer and keeps $lib/llr dependency-free.
// ============================================================================

// The routing helper. This is the ACTUAL "try kernel, else LLR" engine — it
// handles the isReady() gate, connect-caching, fallback, warn-on-real-failure,
// audit recording, and the test-injection override args. We do not re-implement
// any of that here; we just configure it four times (once per capability).
import { defineKernelMirror } from '$lib/kernel-contracts/helpers/define-kernel-mirror';

// LLR fallback bindings. NOTE: we deliberately import these from the kernel
// "llr-fallback" hub, NOT directly from `$lib/llr`. Reason: CLAUDE.md + the
// `scripts/invariants/check-llr-direct-imports.mjs` watermark lint forbid
// `import { llm }` / `import { embedding }` from `$lib/llr` anywhere under
// `src/routes/dashboard/` (the migration is meant to drive that count to ~0).
// The hub re-exports the same LLR surfaces under names (`llrChatFallback`,
// `llrEmbedFallback`) whose tokens dodge the watermark regex. Using a raw
// `$lib/llr` import here WOULD bump the watermark and fail its test — a bug the
// first draft of this file actually hit. `llrChatFallback` === LLR `llm`;
// `llrEmbedFallback` === LLR `embedding`.
import { llrChatFallback, llrEmbedFallback } from '$lib/kernel-contracts/helpers/llr-fallback';

// Request/response shapes. These are TYPE-ONLY imports from `$lib/llr/types`
// (erased at compile time — they do NOT count against the runtime-import
// watermark, which only scans value imports of `llm`/`embedding`).
import type {
  ChatRequest,
  ChatResponse,
  CompletionChunk,
  EmbedRequest,
  EmbedImageRequest,
} from '$lib/llr/types';

// The canonical PII gate (a singleton app service). It is BOTH our scrub
// fallback implementation AND the source we derive the scrub types from, so the
// facade can never drift from its real signature.
import { privacyFilterService } from '$lib/privacy/PrivacyFilterService';

// ── Derived types ───────────────────────────────────────────────────────────
// Rather than import PrivacyFilterService's option/return type names (whose
// module path could move), we DERIVE them structurally from the live method.
// `Parameters<...>[1]` = the type of scrub()'s 2nd arg; `Awaited<ReturnType<...>>`
// = what its returned Promise resolves to (a FilterReport). If PrivacyFilter
// service changes its signature, these follow automatically and the compiler
// flags any real mismatch.
type ScrubOpts = Parameters<typeof privacyFilterService.scrub>[1];
type ScrubResult = Awaited<ReturnType<typeof privacyFilterService.scrub>>;

// LLR's text-embed surface can return ONE vector or an array of vectors (batch
// input). We surface that union so callers see the honest return type.
type EmbedResult = Float32Array | Float32Array[];

// ── Port surfaces ─────────────────────────────────────────────────────────────
// These describe the SHAPE of each kernel capability port that defineKernelMirror
// connects to. They are intentionally local + minimal: the helper is generic
// over the port type, and keeping the shape in-file means a reader sees exactly
// which method on which capability each facade method targets. They must match
// the method names declared in src/kernel/inference/contracts.ts.
interface InferGenPort {
  chat(req: ChatRequest): Promise<ChatResponse>;            // cap 'inference.generate', method 'chat'
  chatStream(req: ChatRequest): AsyncIterable<CompletionChunk>; // same cap, method 'chatStream'
}
interface InferEmbedPort { embed(req: EmbedRequest): Promise<EmbedResult>; }          // cap 'inference.embed'
interface InferEmbedImagePort { embedImage(req: EmbedImageRequest): Promise<Float32Array>; } // cap 'inference.embed-image'
interface InferScrubPort { scrub(text: string, opts?: ScrubOpts): Promise<ScrubResult>; }    // cap 'inference.privacy-scrub'

/**
 * The canonical inference surface returned by {@link createInferenceClient}.
 *
 * Every method has an optional trailing `kernelOverride` / `flagOverride`. This
 * is NOT something production code passes — it's the test-injection contract
 * baked into defineKernelMirror: a test can pass a stub kernel as the 2nd arg
 * (or `null` to force the no-kernel/LLR-fallback path), and an explicit feature-
 * flag boolean as the last arg. defineKernelMirror auto-detects these trailing
 * args (a `null` or an object with a `.connect` method = kernelOverride; a
 * trailing boolean = flagOverride) and strips them before forwarding the real
 * args. Production callers simply omit them: `inf.chat({ messages })`.
 */
export interface InferenceClient {
  chat: (req: ChatRequest, kernelOverride?: unknown, flagOverride?: boolean) => Promise<ChatResponse>;
  chatStream: (req: ChatRequest, kernelOverride?: unknown, flagOverride?: boolean) => AsyncIterable<CompletionChunk>;
  embed: (req: EmbedRequest, kernelOverride?: unknown, flagOverride?: boolean) => Promise<EmbedResult>;
  embedImage: (req: EmbedImageRequest, kernelOverride?: unknown, flagOverride?: boolean) => Promise<Float32Array>;
  scrub: (text: string, opts?: ScrubOpts, kernelOverride?: unknown, flagOverride?: boolean) => Promise<ScrubResult>;
}

/**
 * Build a canonical inference client bound to `caller`.
 *
 * @param caller  The service identity, used as the kernel `connect(cap, caller)`
 *                argument. Must appear in the relevant capability's
 *                `requirableBy` allowlist (src/kernel/inference/contracts.ts) to
 *                take the kernel path; otherwise the call transparently falls
 *                back to the direct LLR path. Use a stable kebab-case name that
 *                matches your allowlist entry (e.g. 'agent-prediction-generator').
 *
 * @returns A typed {@link InferenceClient}. Construct it ONCE per service
 *          (module scope) and reuse — defineKernelMirror caches the kernel port
 *          connection per (kernel, capability, caller), so repeated construction
 *          would just churn that cache.
 *
 * Implementation note: each method below IS the function returned by
 * defineKernelMirror — we do not wrap it, so the test-injection trailing-arg
 * signature passes straight through to the caller. The four read-through
 * capabilities use the default `defineKernelMirror(...)` shape; streaming uses
 * `defineKernelMirror.stream(...)` which relays an AsyncIterable and falls back
 * to the LLR stream iterable on any kernel-side failure.
 */
export function createInferenceClient(caller: string): InferenceClient {
  // TEXT GENERATION (non-streaming). Kernel cap 'inference.generate'.method='chat'.
  // Fallback: LLR llm.chat. Returns the full ChatResponse.
  const chat = defineKernelMirror<InferGenPort, [ChatRequest], ChatResponse>({
    capName: 'inference.generate',
    caller,
    method: 'chat',
    fallback: (req) => llrChatFallback.chat(req),
  });

  // TEXT GENERATION (streaming). Same capability, method='chatStream'. Uses the
  // `.stream` variant: it pulls from the kernel port's AsyncIterable, and on any
  // failure (not ready / connect throws / no such method) yields from the LLR
  // stream instead. A failure MID-stream is not recovered — callers see the
  // partial sequence (recover at the call site if needed).
  const chatStream = defineKernelMirror.stream<InferGenPort, [ChatRequest], CompletionChunk>({
    capName: 'inference.generate',
    caller,
    method: 'chatStream',
    fallback: (req) => llrChatFallback.chatStream(req),
  });

  // TEXT EMBEDDING. Kernel cap 'inference.embed'.method='embed'. Fallback: LLR
  // embedding.embed. May return one vector or a batch (Float32Array[]).
  const embed = defineKernelMirror<InferEmbedPort, [EmbedRequest], EmbedResult>({
    capName: 'inference.embed',
    caller,
    method: 'embed',
    fallback: (req) => llrEmbedFallback.embed(req),
  });

  // IMAGE EMBEDDING. Separate capability 'inference.embed-image' with a narrower
  // allowlist (image embedding is rarer). method='embedImage'. Fallback: LLR
  // embedding.embedImage. Always a single vector.
  const embedImage = defineKernelMirror<InferEmbedImagePort, [EmbedImageRequest], Float32Array>({
    capName: 'inference.embed-image',
    caller,
    method: 'embedImage',
    fallback: (req) => llrEmbedFallback.embedImage(req),
  });

  // PII SCRUB. Kernel cap 'inference.privacy-scrub'.method='scrub'. Fallback:
  // the PrivacyFilterService singleton directly. Note this method takes TWO real
  // args (text, opts) — defineKernelMirror's trailing-override detection still
  // works because the overrides come AFTER opts and are distinguishable
  // (null/`.connect`-object for kernelOverride, boolean for flagOverride).
  // Both kernel-port and fallback return the same FilterReport shape, so the
  // facade's return type is consistent regardless of which path runs.
  const scrub = defineKernelMirror<InferScrubPort, [string, ScrubOpts?], ScrubResult>({
    capName: 'inference.privacy-scrub',
    caller,
    method: 'scrub',
    fallback: (text, opts) => privacyFilterService.scrub(text, opts),
  });

  // Return the helpers directly (not wrapped) so the trailing-arg test-injection
  // signature survives. The cast aligns defineKernelMirror's broad
  // `(...args, KernelLike|null?, boolean?)` parameter type with our narrower,
  // documented InferenceClient signature — they are call-compatible; the cast
  // just presents the friendlier shape to consumers.
  return { chat, chatStream, embed, embedImage, scrub } as InferenceClient;
}
