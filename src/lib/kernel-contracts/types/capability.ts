// @graph-layer: infrastructure
// @rationale: type stubs for kernel contract scaffolding

export type CapabilityContract = {
  [key: string]: unknown;
};

export function defineContract<T>(def: T): CapabilityContract {
  return def as CapabilityContract;
}
