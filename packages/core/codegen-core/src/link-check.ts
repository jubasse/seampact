import { firstPartyPackagesOfStyle } from "@seampact/spec/compatibility";
import type { LinkKind, LinkStyle } from "./descriptors.js";
import type { LinkNeeds, LinkSet, Links, OptionalNeed } from "./links.js";
import type { Refusal } from "./refusal.js";

// One refusal per consumed kind whose link is missing (unless the kind is optional), of another kind or of a style the target does not read,
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
  client: (needs, links) => refuseUnmetLink("client", needs.client, links.client),
};

// True when every consumed kind has a link the link check accepts.
export function meetsEveryNeed<Consumed extends LinkKind, Optional extends Consumed = never>(
  links: LinkSet,
  needs: LinkNeeds<Consumed>,
): links is LinkSet & Links<Consumed, Optional> {
  return refuseUnmetLinks(needs, links).length === 0;
}

function refuseUnmetLink<Kind extends LinkKind>(
  kind: Kind,
  need: { styles: readonly LinkStyle<Kind>[]; optional?: OptionalNeed } | undefined,
  link: { descriptor: { kind: LinkKind; style: string } } | undefined,
): Refusal[] {
  if (need === undefined) return [];

  const accepted = need.styles.join(", ");
  const providers = providerList(need.styles);

  if (link === undefined && need.optional !== undefined) return [];

  if (link === undefined) {
    return [
      {
        code: "link.missing",
        message: `This target consumes a '${kind}' link in style ${accepted}, and none is given.`,
        fix: `Link ${providers} in the target's \`link\` entry.`,
      },
    ];
  }

  const { descriptor } = link;

  if (descriptor.kind !== kind) {
    return [
      {
        code: "link.kind.mismatch",
        message: `The '${kind}' link points at a '${descriptor.kind}' descriptor.`,
        fix: `Link ${providers}.`,
      },
    ];
  }

  if (!need.styles.some((style) => style === descriptor.style)) {
    return [
      {
        code: "link.style.unsupported",
        message: `The '${kind}' link provides style '${descriptor.style}'; this target reads ${accepted}.`,
        fix: `Link ${providers}${noLinkAlternative(kind, need)}.`,
      },
    ];
  }

  return [];
}

function noLinkAlternative(kind: LinkKind, need: { optional?: OptionalNeed }): string {
  if (need.optional === undefined) return "";

  return `, or no \`${kind}\` link to use the target's own ${need.optional.ownLibrary} validators`;
}

// The first-party packages of every accepted style, read from the compatibility matrix, such as
// "`@seampact/codegen-zod` or `@seampact/codegen-yup`".
function providerList(styles: readonly LinkStyle[]): string {
  return listOf(
    styles.flatMap((style) => firstPartyPackagesOfStyle(style)).map((name) => `\`${name}\``),
  );
}

function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");

  return `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
}
