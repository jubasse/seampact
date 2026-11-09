import type { ContractIR } from "@seampact/spec/ir";

// The base paths a server serves an api under: each surface's prefix behind the entry's `mount`, without repeats.

/** The api's mounted base paths, in surface order, each once; an api without a prefix or mount gives `""`. */
export function mountedBasePaths(ir: ContractIR, mount: string): string[] {
  return [...new Set(Object.values(ir.api.surfaces).map((surface) => `${mount}${surface.prefix}`))];
}
