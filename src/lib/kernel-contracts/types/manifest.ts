// Kernel manifest types
export interface Manifest {
  name: string;
  module?: string | (() => Promise<unknown>);
  [key: string]: unknown;
}
