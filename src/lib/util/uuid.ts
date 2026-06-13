// Safe UUID v4. crypto.randomUUID() exists ONLY in secure contexts
// (HTTPS or localhost); this demo is served over plain HTTP on a Tailscale IP,
// where crypto.randomUUID is undefined and throws. Fall back to getRandomValues,
// then Math.random, so ID generation works everywhere.
export function uuid(): string {
	const c: Crypto | undefined = (globalThis as { crypto?: Crypto }).crypto;
	if (c && typeof c.randomUUID === 'function') {
		try {
			return c.randomUUID();
		} catch {
			/* fall through */
		}
	}
	const bytes = new Uint8Array(16);
	if (c && typeof c.getRandomValues === 'function') {
		c.getRandomValues(bytes);
	} else {
		for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
	bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
	const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
	return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10, 16).join('')}`;
}
