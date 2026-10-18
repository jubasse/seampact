import type { DescriptorByKind, LinkKind, LinkStyle } from "./descriptors.js";

// A consumer's need: one link of this kind, in one of these styles.
export type LinkNeed<Kind extends LinkKind = LinkKind> = {
  [Each in Kind]: { kind: Each; styles: readonly LinkStyle<Each>[] };
}[Kind];

// What a provider offers: one descriptor of this kind and style.
export type LinkOffer<Kind extends LinkKind = LinkKind> = {
  [Each in Kind]: { kind: Each; style: LinkStyle<Each> };
}[Kind];

// Where the provider's output root is, seen from the consumer (ADR 0009, ADR 0011): a POSIX path relative to the
// consumer's output root, or the explicit module specifier the app config gives when the outputs live in
// different packages.
export type LinkLocation =
  | { kind: "relative"; path: string }
  | { kind: "module"; specifier: string };

export interface Link<Kind extends LinkKind = LinkKind> {
  descriptor: DescriptorByKind[Kind];
  location: LinkLocation;
}

// The links a target's own generate receives: one per kind it consumes, present since the link check passed.
export type Links<Consumed extends LinkKind> = { readonly [Kind in Consumed]: Link<Kind> };

// The links the CLI passes, keyed by kind as the app config's `link` is; the link check refuses a missing one.
export type LinkSet = { readonly [Kind in LinkKind]?: Link<Kind> };
