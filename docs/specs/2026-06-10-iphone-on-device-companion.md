# iPhone On-Device Companion — Architecture Brief (WWDC26)

**Date:** 2026-06-10
**Status:** DRAFT — architecture brief for the codex follow-up session
**Patches/extends:** [2026-05-24-design.md](2026-05-24-design.md) (§3.4–§3.9 pipeline) and [2026-05-25-hd2d-renderer-pivot.md](2026-05-25-hd2d-renderer-pivot.md)
**Primary sources:** WWDC26 sessions 241/319/324/326/339; `developer.apple.com/documentation/FoundationModels`; `developer.apple.com/documentation/imageplayground`; WebKit Safari-27-beta post; Draw Things iPhone-17-Pro benchmarks; press coverage flagged inline where a claim is press-only.

---

## 1. TL;DR

WWDC26 (June 8–12, 2026; iOS 27 / macOS 27 "Golden Gate", GA fall 2026) makes **three of our five pipeline stages genuinely $0 on-device**, and confirms the fourth was already free. What it does NOT give us is the one thing that is our moat: **multi-reference character-consistent print-resolution illustration**.

**Free on-device today (iOS 27 beta APIs):**
- **Story SceneTree generation** — the rebuilt on-device Foundation Model (3rd-gen AFM) with `@Generable` guided generation: constrained decoding straight into typed Swift structs. This is strictly better than Ollama JSON mode for our 7-beat hierarchical SceneTree. Free, offline, no request limits. **Hard constraint:** 4K-token context (8K on newest devices) vs our ~3K-token system prompt — needs prompt compression or per-beat sessions (§6 M1).
- **Photo→pillar match** — no Apple CLIP-space API exists, but we don't need one: ship our own `clip-vit-base-patch32` as Core ML (~150 MB fp16, ANE-fast), or keep the existing WASM CLIP running inside the WKWebView. Photo never leaves the device either way — identical privacy posture to ADR-0043 (§5).
- **Draft illustrations** — three on-device options, all draft-grade: (a) our in-repo HD-2D THREE r171 engine already renders in any WebGL2 context including WKWebView — zero new work and it's the only option with character consistency (pillar billboards); (b) Image Playground on-device styles (Animation/Illustration/Sketch — fast, free, stylized, **no character consistency**); (c) FLUX.1-schnell-class via the new Core AI framework or MLX — ~35 s per 768px image on iPhone 17 Pro, thermal throttling after ~1 min, draft quality only.
- **PDF assembly** — PDFKit native, or keep `BookAssembler` (pdf-lib) in the WebView. Name-overlay keystone stays local. Unchanged.

**Effectively-$0 cloud (Apple-subsidized, quota-bound):** `PrivateCloudComputeLanguageModel` — frontier-class, 32K context, `reasoningLevel`, zero API cost for apps under 2M first-time downloads, per-user daily quotas, no API keys. This is the story-quality fallback when the 4K window pinches. PCC also powers the new photorealistic Image Playground model — but with SynthID watermarks, per-user quotas, reportedly Gemini-backed, and **no multi-reference identity control**, so it is unsuitable for 24 consistent spreads of a real child.

**Stays on our infra:** print-res character-consistent rendering (Qwen-Image-2512 + Edit-2511 multi-ref on the 4090 or fal — nothing announced at WWDC26 does multi-reference identity consistency), Lulu Direct POD, Stripe.

**Honest gaps:** the "AFM 3 ≈ 20B sparse / 1–4B active" parameter claim is press-derived (ofox.ai, byteiota), not yet in Apple docs; creative-writing quality vs our `gemma3:12b` baseline is unbenchmarked; Foundation Models are NOT exposed to WKWebView JavaScript (native Swift bridge required); image input needs iPhone 15 Pro+ (A17 Pro+); Apple Intelligence is reportedly unavailable at launch in the EU (iPhone/iPad) and mainland China. Full list in §7.

**No competitor storybook app uses these APIs yet** (App Store storybook apps are all cloud-API based). First-mover window is open until iOS 27 GA in fall 2026.

---

## 2. Pipeline mapping

| Stage | On-device option (framework · est. latency · quality) | Our-infra option | Recommended split |
|---|---|---|---|
| **Story LLM** (7-beat → SceneTree, spec §3.5) | FoundationModels `LanguageModelSession` + `@Generable` SceneTree structs · seconds per beat · instruction-following + tool calling improved in AFM 3; 4K ctx (8K newest); free, offline, no limits. Introspection: `model.contextSize`, `tokenCount(for:)` | Today: `kernel.connect('inference.generate')` → gemma3:12b (Ollama dev) / LLR. Middle tier: **PCC** 32K ctx + `reasoningLevel`, $0 under 2M downloads, per-user quota | **On-device per-beat sessions** with compressed system prompt; PCC for single-shot full-tree + quality-sensitive regens. `LanguageModel` protocol means one session API targets Apple/PCC/MLX/Anthropic — keep our server path as a 4th backend |
| **Illustration — draft** (spec §3.6–3.7) | (a) **HD-2D engine in WKWebView** (WebGL2, ships today) · ~real-time captures · character-consistent via pillar billboards; (b) Image Playground on-device trio · fast · stylized, no identity; (c) FLUX.1-schnell via Core AI/MLX · ~35 s/768px (iPhone 17 Pro), 8–12 s SD1.5/512px (16 Pro) · draft, thermal-limited | PCC photorealistic ImageCreator (quota, SynthID, no multi-ref) — **not viable for spreads**. Print track: Qwen-Image-2512 + Edit-2511 multi-ref, 4090/fal | **HD-2D WebView is the default draft renderer** (already built, already consistent). Image Playground as an optional "stylized variant" delight. FLUX/Core AI = experiment, not roadmap |
| **Illustration — print-res** | None feasible. Qwen-class 20B MMDiT is not phone-runnable; FLUX 11B quantized = draft-only | **Qwen-Image-2512 + Edit-2511 multi-ref on 4090/fal** — the only multi-reference identity-consistent path that exists | 100% our infra. This is the paid tier (§3) |
| **Photo→pillar match** (spec §3.4) | Ship `clip-vit-base-patch32` Core ML via coremltools or Core AI (.aimodel) · ~150 MB fp16 · ANE ~tens of ms (vs ~500 ms WASM); or keep WASM CLIP in WKWebView (works today). Vision FeaturePrint / FM `imageEncode` are **different vector spaces** — incompatible with manifest | `/api/vectorize` stateless fallback endpoint (already exists; photo discarded synchronously) | **On-device always** (privacy moat). Decision + rationale in §5 |
| **Assembly** (spec §3.9) | PDFKit (native) or BookAssembler/pdf-lib in WebView · seconds · print-spec output unchanged. Name composited locally — only step touching kid's name | n/a — assembly is local by design (ADR-0043) | **Local always.** Keep pdf-lib in M1 (zero churn); PDFKit native port only if WebView memory becomes a problem |
| **Print + fulfillment** | n/a | **Lulu Direct + Stripe** (already built: `services/fulfillment/`) | 100% our infra. Physical goods are exempt from Apple IAP — Stripe checkout is allowed in-app |

---

## 3. The hybrid product shape — one SceneTree, two render tiers

**FREE on-device tier ("instant draft book"):**
1. Parent walks the workshop in the native-shell app (SvelteKit in WKWebView).
2. Photo → local CLIP → pillar match (nothing leaves the device).
3. Foundation Model writes the SceneTree (`@Generable`, per-beat sessions). Offline-capable. $0 marginal cost.
4. HD-2D engine renders draft spreads in the WebView; PreText typography composites on top; pdf-lib assembles a watermark-free draft book + read-along.
5. Parent gets a **complete, shareable draft book in under a minute, free, forever**. This is the viral loop: share link → email gate → CRM (existing marketing funnel). Zero marginal inference cost to us means the free tier scales without burning cash.

**PAID print tier ("the heirloom"):**
1. Parent taps "Print this book." The **same SceneTree JSON** (plus pillar IDs and style choice — never the photo, never the name in pipeline) uploads to our infra.
2. 4090/fal re-renders all 24 spreads print-res with Qwen-Image-2512 + Edit-2511 multi-ref character consistency, keyed to the pillar billboard reference set.
3. Name overlay happens in the final local-assembly pass (keystone preserved) OR at our compositor with the name transmitted solely under the existing `book_fulfillment` purpose at checkout — decide in M3 (§6).
4. Lulu-spec validation → Stripe → Lulu Direct POD → doorstep.

**The contract is the SceneTree.** Draft and print tiers are two renderers over one artifact. Every redo affordance (spec §3.10) operates on the SceneTree and is therefore free at draft tier. The paid tier is a deterministic re-render, not a re-authoring — what you proofed is what you get, at print quality.

---

## 4. LilAIputia questing integration (1 page)

The storybook app stays a separate product, but the quest economy feeds it and consumes it. Four concrete touchpoints:

1. **Quest → story seed.** A completed (or active) quest in pachinko-app produces a `StorySeed`: `{ theme, castPillarIds[], settlerIds[], localeBiome, beatHints[] }` derived from QuestSpec/QuestBeats. Transport: the existing public Skill-marketplace API the workshop already uses for settler discovery — add one `GET /api/skills/story-seeds` surface. The lead settler who ran the quest becomes the book's host/cameo (already in the design spec's cast model).
2. **Finished book → quest artifact.** On draft completion, the storybook app POSTs an artifact receipt: `{ sceneTreeHash, pillarIds[], settlerIds[], styleEnum, completedAt }` — **no kid PII, no prose, no images** (hash + opaque IDs only, consistent with ADR-0043 and the no-PII-on-chain rule). Pachinko mints it earned-world style (same shape as `WorldItemNFT` quest artifacts): the book appears as a village artifact the settlers reference; a printed-tier purchase upgrades the artifact's rarity tier.
3. **Shared contracts.** Two schemas get extracted to a tiny shared package (or copied with a sync test): the **SceneTree JSON schema** (already the author/render contract here) and the **pillar manifest entry** shape (`PillarManifestClient` parse contract). Settlers in pachinko can then *narrate over* a book's SceneTree (banter about beats they "starred in") without ever seeing the rendered book.
4. **App Intents bridge (iOS).** Expose `CreateStorybookFromQuestIntent` (parameters: story-seed ID) and `OpenBookIntent`. Quests surfaced in Spotlight's semantic index ("make a bedtime story about Otis's mountain quest") deep-link into the workshop with the seed pre-loaded. App Intents are mandatory in iOS 27 anyway — this is the same work, pointed at the quest loop.

Not in scope: cross-user book sharing through the commons, settler royalties on book sales (interesting — park it), any kid-identifying data in pachinko.

---

## 5. Photo-match portability — decision

**Decision: ship `clip-vit-base-patch32` converted to Core ML (coremltools, fp16, ~150 MB) and keep the manifest embedding space exactly as it is.** MobileCLIP is rejected for now.

Why:
- **The manifest space is load-bearing.** Every pillar embedding (50-entry placeholder today; 5,000-archetype Pixal3D library in flight per goal 2026-05-25) lives in clip-vit-base-patch32's 512-dim space. Re-embedding with MobileCLIP B-LT (173 MB, also 512-dim but a *different* space) forces a one-time re-embed **plus** re-validation of match quality across the whole library — while the library bake itself is still in flight. Two moving targets, one validation budget.
- **One encoder, one truth, three runtimes.** The same weights run as WASM (web, today, ~500 ms), Core ML/ANE (iOS, ~tens of ms), and Node (the `/api/vectorize` fallback). Cosine similarities are comparable everywhere; goldens transfer.
- **It's proven.** CDN-loaded `Xenova/clip-vit-base-patch32` already passes the repo's vectorizer/matcher test suites; coremltools conversion of ViT-B/32 is a long-trodden path; Core AI's `.aimodel` route is available as a v2 optimization, not a dependency.
- **Cheapest M1 is actually "do nothing":** the WASM path runs inside WKWebView unmodified. The Core ML port is a *latency/battery upgrade* (ANE vs WASM CPU), not a launch blocker — schedule it in M2, behind the same `PillarVectorizerService` interface.
- Revisit trigger: if the Pixal3D library lands with its own re-embed pass anyway, MobileCLIP can be re-evaluated in the same pass at near-zero marginal validation cost.

---

## 6. Build plan — 3 milestones

**M1 — Native shell + on-device story draft.** *(est. 2–3 weeks, 1 dev)*
- SwiftUI shell hosting the SvelteKit app in WKWebView; bridge via `WKScriptMessageHandler` + the new `WKJSHandle`/`WKSerializedNode` APIs (Foundation Models are NOT web-exposed; Safari has no WebNN/prompt API — the bridge is mandatory).
- Bridge surface v1: `story.generateBeat(profile, beatIndex) → SceneTree fragment` backed by FoundationModels `@Generable` structs; per-beat `LanguageModelSession`s to live inside the 4K/8K window; `tokenCount(for:)` instrumentation; PCC fallback behind the same bridge method.
- System-prompt compression pass: ~3K tokens → ≤1.5K (Stein-Glenn rules + age-band caps survive; Tier-2 word list moves to the user message per-beat).
- Existing validators unchanged: `StoryGrammarValidator`, `AgeBandCalibrator`, KidsContentSafety, PrivacyFilter all run in the WebView on the bridged output.
- **Risks:** iOS 27 beta API churn through fall GA; 4K window still too tight after compression (mitigation: PCC default, on-device as offline mode); EU/China Apple Intelligence unavailability fragmenting the free tier; creative quality vs gemma3:12b unknown until benched (run the repo's storyteller eval harness via the Evaluations framework + `fm` CLI on macOS 27 in week 1 — this is the M1 go/no-go gate).

**M2 — On-device draft illustrations + photo match.** *(est. 2–3 weeks, 1 dev)*
- Verify the HD-2D THREE r171 engine on iPhone-class GPUs inside WKWebView (WebGL2 is supported; OffscreenCanvas/headless capture behavior + memory ceilings need device QA); capture pipeline `canvas.toBlob` → draft spreads, unchanged from the renderer-pivot spec.
- Optional delight track: Image Playground `ImageCreator` "stylized variant" button on the on-device Animation/Illustration/Sketch styles (free, no identity guarantee — labeled as such in UI).
- CLIP Core ML port behind `PillarVectorizerService` (§5): coremltools conversion, ANE profiling on A17 Pro/A19, golden-vector parity tests vs WASM (cosine drift < 1e-3 budget).
- **Risks:** WebView WebGL memory/thermal limits on 24-spread sessions (mitigation: render-per-page-turn, LRU spread cache in IDB); ImageCreator creation-limit errors; fp16 conversion drifting match rankings (golden tests catch).

**M3 — Print-tier handoff + questing hooks.** *(est. 2 weeks, 1 dev + infra time)*
- `POST /api/print-jobs`: SceneTree + pillarIds + style up; Qwen-Image-2512/Edit-2511 multi-ref render queue on 4090 (fal burst overflow); Lulu-spec validator pre-charge; Stripe (physical goods — IAP-exempt, confirm during App Review prep); status push back to the shell.
- Decide name-composition locus (local final-pass vs `book_fulfillment`-purposed server composite) — privacy review required if server-side.
- Questing hooks per §4: story-seed consumption + artifact receipt + the two App Intents.
- **Risks:** draft (HD-2D) vs print (Qwen) style gap surprising buyers (mitigation: show one print-res sample spread before checkout); 4090 queue depth at launch spikes (fal as elastic overflow); App Review on AI-generated-children imagery — our print renders are our-infra, not PCC, so Apple content policy doesn't gate them, but Review may still probe (prep a policy doc).

---

## 7. Open questions for the codex follow-up session

1. **AFM 3 architecture claim** — verify "~20B sparse / 1–4B active via Instruction-Following Pruning" against the Apple ML Research tech report before any quality assumption; press-only today (ofox.ai, byteiota).
2. **Story-quality bench** — run the repo's storyteller eval set through the Evaluations framework + `fm` CLI (macOS 27 beta) vs the gemma3:12b baseline. Output: pass/fail on read-aloud-rhythm + Stein-Glenn + age-band metrics. This gates M1.
3. **Prompt budget** — exact `tokenCount(for:)` of the compressed system prompt + worst-case beat payload on 4K and 8K devices; decide per-beat vs two-phase (skeleton then scenes) session design.
4. **WKWebView ceilings** — OffscreenCanvas support, WebGL2 context limits, and memory budget for 24 print-aspect captures on A16/A17/A19; does the HD-2D engine need a native Metal fallback (hope: no).
5. **ImageCreator quotas + policy** — per-user creation limits, and whether the PCC photorealistic model (reportedly Gemini-backed) refuses/watermarks images of identifiable children — affects only the optional delight track, but find out before building UI.
6. **CLIP conversion route** — coremltools `.mlpackage` vs Core AI `.aimodel`: ANE residency, load time, and whether `.aimodel` AOT compilation meaningfully beats the classic path on A17+.
7. **EU/China launch posture** — confirm Apple Intelligence availability windows; design the no-FM fallback (PCC also unavailable? then server-LLM draft tier for those markets) — decides whether the free tier is global at launch.
8. **Device floor UX** — image-input (Attachment API) needs iPhone 15 Pro+; on older devices the photo→pillar match still works (our CLIP, not FM) but FM vision features don't — enumerate exactly which features degrade and how the UI explains it.
9. **`LanguageModel` protocol adapter** — spike a 4th backend that targets our existing kernel `inference.generate` server path, so web, iOS-on-device, PCC, and our-infra all sit behind one session abstraction.
10. **Artifact receipt schema** — finalize the §4 receipt + story-seed shapes with the pachinko side (sync test in both repos) before M3.
