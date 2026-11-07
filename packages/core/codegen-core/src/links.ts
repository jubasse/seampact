import type { DescriptorByKind, LinkKind, LinkStyle } from "./descriptors.js";

// What a target generates itself when an optional link is not given, such as `ajv`, named in the refusal of a
// link of a style the target does not read.
export interface OptionalNeed {
  readonly ownLibrary: string;
}

// A consumer's needs, keyed by kind so a consumed kind cannot be left out: one link per kind, in one of these
// styles. An `optional` kind may have no link (the target then generates what the link would give); a link that is
// given is still checked.
export type LinkNeeds<Consumed extends LinkKind = LinkKind> = {
  readonly [Kind in Consumed]: { styles: readonly LinkStyle<Kind>[]; optional?: OptionalNeed };
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

// The links a target's own generate receives: one per kind it consumes, present since the link check passed, except
// the kinds it marks optional, which are absent when the entry gave none.
export type Links<Consumed extends LinkKind, Optional extends Consumed = never> = {
  readonly [Kind in Exclude<Consumed, Optional>]: Link<Kind>;
} & { readonly [Kind in Optional]?: Link<Kind> };

// The links the CLI passes, keyed by kind as the app config's `link` is; the link check refuses a missing one.
export type LinkSet = { readonly [Kind in LinkKind]?: Link<Kind> };
