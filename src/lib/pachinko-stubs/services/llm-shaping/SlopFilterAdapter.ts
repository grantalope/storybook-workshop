// Stub: LLM shaping service (pachinko-app specific)
export class SlopFilterAdapter {
  filter(x: unknown): unknown { return x; }
}

export function readSlopFilterMode(): string {
  return 'none';
}

export function wrapInferenceProviderWithSlopFilter(
  provider: unknown,
  mode: string
): unknown {
  return provider;
}
