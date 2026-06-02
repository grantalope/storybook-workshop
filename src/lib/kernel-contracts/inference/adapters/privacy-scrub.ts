// @graph-layer: infrastructure
// @rationale: infrastructure (kernel — layer-agnostic primitive: supervisor/ports/WAL/effects)

import type { FilterReport, ScrubOptions } from '../../../routes/dashboard/types/PrivacyTypes';

export type { FilterReport, ScrubOptions } from '../../../routes/dashboard/types/PrivacyTypes';

/**
 * The minimal surface we need from PrivacyFilterService. Decoupled so tests
 * can inject a stub.
 */
export interface PrivacyFilterLike {
  scrub(text: string, opts?: ScrubOptions): Promise<FilterReport>;
  isReady(): boolean;
}

export interface PrivacyScrubAdapter {
  scrub(text: string, opts?: ScrubOptions): Promise<FilterReport>;
}

export function createPrivacyScrubAdapter(
  getService: () => PrivacyFilterLike | null,
): PrivacyScrubAdapter {
  return {
    async scrub(text: string, opts?: ScrubOptions): Promise<FilterReport> {
      const s = getService();
      if (!s) throw new Error('PrivacyFilter service not available');
      return s.scrub(text, opts);
    },
  };
}
