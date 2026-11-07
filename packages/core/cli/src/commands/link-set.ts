import { relative, sep } from "node:path";
import type { DescriptorSet, LinkKind, LinkLocation, LinkSet } from "@seampact/codegen-core";

export type MutableLinkSet = { -readonly [Kind in keyof LinkSet]: LinkSet[Kind] };

type AddLink = (
  links: MutableLinkSet,
  descriptors: DescriptorSet,
  location: LinkLocation,
) => boolean;

// One adder per link kind, so a kind read from the app config narrows without a cast and a new kind cannot be
// left out.
const addLinkByKind: { readonly [Kind in LinkKind]: AddLink } = {
  validators(links, descriptors, location) {
    if (descriptors.validators === undefined) return false;

    links.validators = { descriptor: descriptors.validators, location };

    return true;
  },
  types(links, descriptors, location) {
    if (descriptors.types === undefined) return false;

    links.types = { descriptor: descriptors.types, location };

    return true;
  },
  client(links, descriptors, location) {
    if (descriptors.client === undefined) return false;

    links.client = { descriptor: descriptors.client, location };

    return true;
  },
};

export function isLinkKind(kind: string): kind is LinkKind {
  return Object.hasOwn(addLinkByKind, kind);
}

// Adds the link of `kind` when the provider's descriptors hold one; false when they do not.
export function addLink(
  links: MutableLinkSet,
  kind: LinkKind,
  descriptors: DescriptorSet,
  location: LinkLocation,
): boolean {
  return addLinkByKind[kind](links, descriptors, location);
}

// The provider's output root seen from the consumer's, as a POSIX relative path.
export function relativeLocation(consumerRoot: string, providerRoot: string): LinkLocation {
  return { kind: "relative", path: relative(consumerRoot, providerRoot).split(sep).join("/") };
}
