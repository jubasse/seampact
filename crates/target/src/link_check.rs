//! The link check: every consumed kind has a link of an accepted style.

use crate::{LinkKind, LinkSet, Refusal, ResolvedLinkNeed, ResolvedLinkNeeds};

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

        return Some(link_refusal(
            "link.missing",
            format!("This target consumes a '{kind_name}' link in style {accepted}, and none is given."),
            format!("Link {providers} in the target's `link` entry."),
        ));
    };

    let descriptor = &link.descriptor;

    if descriptor.kind() != kind {
        return Some(link_refusal(
            "link.kind.mismatch",
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

    Some(link_refusal(
        "link.style.unsupported",
        format!(
            "The '{kind_name}' link provides style '{}'; this target reads {accepted}.",
            descriptor.style().as_str()
        ),
        format!("Link {providers}{no_link_alternative}."),
    ))
}

fn link_refusal(code: &str, message: String, fix: String) -> Refusal {
    Refusal {
        code: code.to_owned(),
        message,
        fix,
        operation: None,
        member: None,
        docs: None,
    }
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
    use super::*;

    #[test]
    fn lists_providers_as_prose() {
        let names = |list: &[&str]| -> Vec<String> { list.iter().map(|name| (*name).to_owned()).collect() };

        assert_eq!(provider_list(&names(&[])), "");
        assert_eq!(provider_list(&names(&["a"])), "`a`");
        assert_eq!(provider_list(&names(&["a", "b", "c"])), "`a`, `b` or `c`");
    }
}
