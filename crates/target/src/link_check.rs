//! The link check: every consumed kind has a link of an accepted style.

use crate::{LinkKind, LinkSet, Refusal, ResolvedLinkNeed, ResolvedLinkNeeds, refusal_code};

/// One refusal per consumed kind whose link is missing (unless optional), of another kind, or of a
/// style the target does not read, naming the kind and both styles.
#[must_use]
pub fn refuse_unmet_links(needs: &ResolvedLinkNeeds, links: &LinkSet) -> Vec<Refusal> {
    LinkKind::ALL
        .into_iter()
        .filter_map(|kind| refuse_unmet_link(kind, needs.of(kind)?, links))
        .collect()
}

/// True when every consumed kind has a link the link check accepts.
#[must_use]
pub fn meets_every_need(links: &LinkSet, needs: &ResolvedLinkNeeds) -> bool {
    refuse_unmet_links(needs, links).is_empty()
}

fn refuse_unmet_link(kind: LinkKind, need: &ResolvedLinkNeed, links: &LinkSet) -> Option<Refusal> {
    let styles: Vec<&str> = need.styles.iter().map(|style| style.as_str()).collect();
    let accepted = styles.join(", ");
    let providers = provider_list(&need.providers);
    let kind_name = kind.as_str();

    let Some(link) = links.of(kind) else {
        if need.optional.is_some() {
            return None;
        }

        return Some(Refusal::new(
            refusal_code::LINK_MISSING,
            format!(
                "This target consumes a '{kind_name}' link in style {accepted}, and none is given."
            ),
            format!("Link {providers} in the target's `link` entry."),
        ));
    };

    let descriptor = &link.descriptor;

    if descriptor.kind() != kind {
        return Some(Refusal::new(
            refusal_code::LINK_KIND_MISMATCH,
            format!(
                "The '{kind_name}' link points at a '{}' descriptor.",
                descriptor.kind().as_str()
            ),
            format!("Link {providers}."),
        ));
    }

    if need.styles.contains(&descriptor.style()) {
        return None;
    }

    let no_link_alternative = need.optional.map_or_else(String::new, |optional| {
        format!(
            ", or no `{kind_name}` link to use the target's own {} validators",
            optional.own_library
        )
    });

    Some(Refusal::new(
        refusal_code::LINK_STYLE_UNSUPPORTED,
        format!(
            "The '{kind_name}' link provides style '{}'; this target reads {accepted}.",
            descriptor.style().as_str()
        ),
        format!("Link {providers}{no_link_alternative}."),
    ))
}

/// The packages quoted and listed as "`a`, `b` or `c`".
fn provider_list(packages: &[String]) -> String {
    let quoted: Vec<String> = packages.iter().map(|name| format!("`{name}`")).collect();

    match quoted.split_last() {
        Some((last, earlier)) if !earlier.is_empty() => {
            format!("{} or {last}", earlier.join(", "))
        }
        _ => quoted.concat(),
    }
}

#[cfg(test)]
mod tests {
    use indexmap::IndexMap;

    use super::*;
    use crate::{
        Descriptor, Link, LinkLocation, LinkStyle, OptionalNeed, TypesDescriptor,
        ValidatorsDescriptor,
    };

    fn link_of(descriptor: Descriptor) -> Link {
        Link {
            descriptor,
            location: LinkLocation::Relative {
                path: "../provider".to_owned(),
            },
        }
    }

    fn validators_link(style: LinkStyle) -> Link {
        link_of(Descriptor::Validators(ValidatorsDescriptor {
            style,
            schemas: IndexMap::new(),
            operations: IndexMap::new(),
        }))
    }

    fn types_link() -> Link {
        link_of(Descriptor::Types(TypesDescriptor {
            style: LinkStyle::Typescript,
            schemas: IndexMap::new(),
            operations: IndexMap::new(),
        }))
    }

    fn validators_need(optional: Option<OptionalNeed>) -> ResolvedLinkNeeds {
        ResolvedLinkNeeds {
            validators: Some(ResolvedLinkNeed {
                styles: vec![LinkStyle::StandardSchema],
                providers: vec!["@seampact/codegen-zod".to_owned()],
                optional,
            }),
            ..ResolvedLinkNeeds::NONE
        }
    }

    const OWN_AJV: OptionalNeed = OptionalNeed { own_library: "ajv" };

    fn only_validators(link: Link) -> LinkSet {
        LinkSet {
            validators: Some(link),
            ..LinkSet::NONE
        }
    }

    fn codes_and_fixes(refusals: &[Refusal]) -> Vec<(&str, &str)> {
        refusals
            .iter()
            .map(|refusal| (refusal.code.as_str(), refusal.fix.as_str()))
            .collect()
    }

    #[test]
    fn refuses_a_link_of_another_style_naming_both_styles() {
        let links = only_validators(validators_link(LinkStyle::ClassValidator));

        let refusals = refuse_unmet_links(&validators_need(None), &links);

        assert_eq!(
            refusals
                .iter()
                .map(|refusal| refusal.message.as_str())
                .collect::<Vec<_>>(),
            [
                "The 'validators' link provides style 'class-validator'; this target reads standard-schema."
            ]
        );
        assert_eq!(
            codes_and_fixes(&refusals),
            [("link.style.unsupported", "Link `@seampact/codegen-zod`.")]
        );
    }

    #[test]
    fn offers_the_own_library_when_an_optional_link_has_the_wrong_style() {
        let links = only_validators(validators_link(LinkStyle::ClassValidator));

        let refusals = refuse_unmet_links(&validators_need(Some(OWN_AJV)), &links);

        assert_eq!(
            codes_and_fixes(&refusals),
            [(
                "link.style.unsupported",
                "Link `@seampact/codegen-zod`, or no `validators` link to use the target's own ajv validators."
            )]
        );
    }

    #[test]
    fn refuses_a_descriptor_of_another_kind_than_its_slot() {
        let links = only_validators(types_link());

        let refusals = refuse_unmet_links(&validators_need(None), &links);

        assert_eq!(
            refusals
                .iter()
                .map(|refusal| refusal.message.as_str())
                .collect::<Vec<_>>(),
            ["The 'validators' link points at a 'types' descriptor."]
        );
        assert_eq!(
            codes_and_fixes(&refusals),
            [("link.kind.mismatch", "Link `@seampact/codegen-zod`.")]
        );
    }

    #[test]
    fn refuses_a_missing_mandatory_link_and_accepts_a_missing_optional_one() {
        let refusals = refuse_unmet_links(&validators_need(None), &LinkSet::NONE);

        assert_eq!(
            codes_and_fixes(&refusals),
            [(
                "link.missing",
                "Link `@seampact/codegen-zod` in the target's `link` entry."
            )]
        );
        assert_eq!(
            refuse_unmet_links(&validators_need(Some(OWN_AJV)), &LinkSet::NONE),
            []
        );
    }

    #[test]
    fn accepts_a_link_of_an_accepted_style_with_or_without_an_optional_need() {
        let links = only_validators(validators_link(LinkStyle::StandardSchema));

        assert!(meets_every_need(&links, &validators_need(None)));
        assert!(meets_every_need(&links, &validators_need(Some(OWN_AJV))));
        assert!(!meets_every_need(&LinkSet::NONE, &validators_need(None)));
    }

    #[test]
    fn lists_providers_as_prose() {
        let names =
            |list: &[&str]| -> Vec<String> { list.iter().map(|name| (*name).to_owned()).collect() };

        assert_eq!(provider_list(&names(&[])), "");
        assert_eq!(provider_list(&names(&["a"])), "`a`");
        assert_eq!(provider_list(&names(&["a", "b", "c"])), "`a`, `b` or `c`");
    }
}
