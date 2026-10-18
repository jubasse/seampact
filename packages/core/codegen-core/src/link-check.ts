import type { LinkKind, LinkStyle } from "./descriptors.js";
import type { LinkNeeds, LinkSet, Links } from "./links.js";
import type { Refusal } from "./refusal.js";

// One refusal per consumed kind whose link is missing, of another kind or of a style the target does not read,
// naming the kind and both styles (the CLI adds the app config entry ids).
export function refuseUnmetLinks(needs: Partial<LinkNeeds>, links: LinkSet): Refusal[] {
  return Object.values(linkCheckByKind).flatMap((checkKind) => checkKind(needs, links));
}

// One check per kind, so a new kind cannot be left unchecked.
const linkCheckByKind: {
  readonly [Kind in LinkKind]: (needs: Partial<LinkNeeds>, links: LinkSet) => Refusal[];
} = {
  validators: (needs, links) => refuseUnmetLink("validators", needs.validators, links.validators),
  types: (needs, links) => refuseUnmetLink("types", needs.types, links.types),
};

// True when every consumed kind has a link the link check accepts.
export function meetsEveryNeed<Consumed extends LinkKind>(
  links: LinkSet,
  needs: LinkNeeds<Consumed>,
): links is LinkSet & Links<Consumed> {
  return refuseUnmetLinks(needs, links).length === 0;
}

function refuseUnmetLink<Kind extends LinkKind>(
  kind: Kind,
  need: { styles: readonly LinkStyle<Kind>[] } | undefined,
  link: { descriptor: { kind: LinkKind; style: string } } | undefined,
): Refusal[] {
  if (need === undefined) return [];

  const accepted = need.styles.join(", ");

  if (link === undefined) {
    return [
      {
        code: "link.missing",
        message: `This target consumes a '${kind}' link in style ${accepted}, and none is given.`,
        fix: `Link a target that provides '${kind}' in style ${accepted} in the target's \`link\` entry.`,
      },
    ];
  }

  const { descriptor } = link;

  if (descriptor.kind !== kind) {
    return [
      {
        code: "link.kind.mismatch",
        message: `The '${kind}' link points at a '${descriptor.kind}' descriptor.`,
        fix: `Link a target that provides '${kind}' in style ${accepted}.`,
      },
    ];
  }

  if (!need.styles.some((style) => style === descriptor.style)) {
    return [
      {
        code: "link.style.unsupported",
        message: `The '${kind}' link provides style '${descriptor.style}'; this target reads ${accepted}.`,
        fix: `Link a target that provides '${kind}' in style ${accepted}.`,
      },
    ];
  }

  return [];
}
