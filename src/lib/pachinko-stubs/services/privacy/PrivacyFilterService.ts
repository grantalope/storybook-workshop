// Stub: Privacy filter (pachinko-app specific)
export class PrivacyFilterService {
  scrub(text: string): string { return text; }
  warmup(): Promise<void> { return Promise.resolve(); }
  isReady(): boolean { return false; }
}
