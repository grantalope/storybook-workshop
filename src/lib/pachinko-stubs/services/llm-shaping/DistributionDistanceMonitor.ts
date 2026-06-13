// Stub: Distribution monitoring (pachinko-app specific)
export class DistributionDistanceMonitor {
  measure(x: unknown): number { return 0; }
}

export const distributionDistanceMonitor = new DistributionDistanceMonitor();

export function isDistanceMonitorEnabled(): boolean {
  return false;
}
