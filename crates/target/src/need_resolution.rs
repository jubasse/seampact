//! A target's needs with their styles read from the metadata or the compatibility data.

use crate::{
    CompatibilityError, CompatibilityKey, CompatibilityMatrix, LinkKind, LinkNeed, LinkNeeds,
    LinkStyle, NeedStyles, ResolvedLinkNeed, ResolvedLinkNeeds,
};

/// Reads every need's styles, and the first-party providers of each style the refusals name;
/// done once per entry by the run planning with the run's matrix.
///
/// # Errors
///
/// When a need reads its styles from the compatibility data and the target has no record of a
/// role that records them: validators styles from a server record, client styles from a client
/// record.
pub fn resolve_link_needs(
    needs: &LinkNeeds,
    compatibility: Option<CompatibilityKey>,
    matrix: &CompatibilityMatrix,
) -> Result<ResolvedLinkNeeds, CompatibilityError> {
    let mut resolved = ResolvedLinkNeeds::NONE;

    for kind in LinkKind::ALL {
        let Some(need) = needs.of(kind) else {
            continue;
        };
        let need = resolve_need(kind, need, compatibility, matrix)?;

        match kind {
            LinkKind::Validators => resolved.validators = Some(need),
            LinkKind::Types => resolved.types = Some(need),
            LinkKind::Client => resolved.client = Some(need),
        }
    }

    Ok(resolved)
}

fn resolve_need(
    kind: LinkKind,
    need: &LinkNeed,
    compatibility: Option<CompatibilityKey>,
    matrix: &CompatibilityMatrix,
) -> Result<ResolvedLinkNeed, CompatibilityError> {
    let styles: Vec<LinkStyle> = match need.styles {
        NeedStyles::Listed(styles) => styles.to_vec(),
        NeedStyles::FromCompatibility => recorded_styles(kind, compatibility, matrix)?,
    };
    let providers: Vec<String> = styles
        .iter()
        .flat_map(|style| matrix.first_party_packages_of_style(*style))
        .map(str::to_owned)
        .collect();

    Ok(ResolvedLinkNeed {
        styles,
        providers,
        optional: need.optional,
    })
}

fn recorded_styles(
    kind: LinkKind,
    compatibility: Option<CompatibilityKey>,
    matrix: &CompatibilityMatrix,
) -> Result<Vec<LinkStyle>, CompatibilityError> {
    match (kind, compatibility) {
        (LinkKind::Validators, Some(CompatibilityKey::Server(package))) => {
            Ok(matrix.server_target(package)?.validator_styles.clone())
        }
        (LinkKind::Client, Some(CompatibilityKey::Client(package))) => {
            Ok(matrix.client_target(package)?.client_styles.clone())
        }
        (_, key) => Err(CompatibilityError::Invalid {
            message: format!(
                "records no '{}' styles for {key:?}: a validators need reads a server record, a client need a client record.",
                kind.as_str()
            ),
        }),
    }
}
