import type { DescriptorByKind, LinkKind, LinkStyle } from "./descriptors.js";

// A consumer's needs, keyed by kind so a consumed kind cannot be left out: one link per kind, in one of these
// styles.
export type LinkNeeds<Consumed extends LinkKind = LinkKind> = {
  readonly [Kind in Consumed]: { styles: readonly LinkStyle<Kind>[] };
};

// What a provider offers, keyed by kind: one descriptor per kind, in this style.
export type LinkOffers<Provided extends LinkKind = LinkKind> = {
  readonly [Kind in Provided]: { style: LinkStyle<Kind> };
};

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
