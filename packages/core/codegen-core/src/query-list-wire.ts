import type { QueryWire } from "@seampact/spec/ir";

// An exploded list is the default `repeat` form (`tag=a&tag=b`); an unexploded one is the `comma` form (`tag=a,b`).
export function queryListWireOf(wire: QueryWire): "repeatedList" | "list" {
  return wire.explode ? "repeatedList" : "list";
}
