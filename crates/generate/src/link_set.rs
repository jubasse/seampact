//! The links a consumer receives from the providers it names.

use camino::Utf8Path;
use seampact_paths::node_path;
use seampact_target::{DescriptorSet, Link, LinkKind, LinkLocation, LinkSet};

/// The link kind written `kind`, when it is one.
pub(crate) fn is_link_kind(kind: &str) -> Option<LinkKind> {
    LinkKind::ALL
        .into_iter()
        .find(|known| known.as_str() == kind)
}

/// Where a consumer in `consumer_root` finds the provider in `provider_root`.
pub(crate) fn relative_location(
    consumer_root: &Utf8Path,
    provider_root: &Utf8Path,
) -> LinkLocation {
    LinkLocation::Relative {
        path: node_path::relative(consumer_root, provider_root).into_string(),
    }
}

/// Adds the link of `kind` to `links`; false when the descriptors hold none of that kind.
pub(crate) fn add_link(
    links: &mut LinkSet,
    kind: LinkKind,
    descriptors: &DescriptorSet,
    location: LinkLocation,
) -> bool {
    let Some(descriptor) = descriptors.of(kind) else {
        return false;
    };

    links.insert(
        kind,
        Link {
            descriptor: descriptor.clone(),
            location,
        },
    );

    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_three_kinds_are_link_kinds() {
        for (text, known) in [
            ("validators", true),
            ("types", true),
            ("client", true),
            ("toString", false),
            ("constructor", false),
            ("", false),
        ] {
            assert_eq!(is_link_kind(text).is_some(), known, "kind {text:?}");
        }
    }

    #[test]
    fn a_provider_next_to_the_consumer_is_found_by_a_relative_path() {
        let location = relative_location(Utf8Path::new("/app/web"), Utf8Path::new("/app/api"));

        assert_eq!(
            location,
            LinkLocation::Relative {
                path: "../api".to_owned()
            }
        );
    }

    #[test]
    fn a_missing_descriptor_adds_no_link() {
        let mut links = LinkSet::default();
        let added = add_link(
            &mut links,
            LinkKind::Client,
            &DescriptorSet::default(),
            LinkLocation::Relative {
                path: "..".to_owned(),
            },
        );

        assert!(!added);
        assert_eq!(links, LinkSet::default());
    }
}
