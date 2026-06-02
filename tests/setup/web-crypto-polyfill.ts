// Node 18 vitest env lacks globalThis.crypto; polyfill via node:crypto.webcrypto.
// Production browser already has globalThis.crypto (Web Crypto API).
import { webcrypto } from "node:crypto";
if (!(globalThis as { crypto?: unknown }).crypto) {
	(globalThis as { crypto?: unknown }).crypto = webcrypto as unknown;
}
