//! The layer of an origin: a closed set, with any other text refused at decode.

use std::fmt;
use std::str::FromStr;

use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::{IrError, PackName};

/// The prefix of a pack layer, `pack:<name>`.
const PACK_PREFIX: &str = "pack:";

/// The character a pack name cannot hold: it separates a layer from a pointer in a location key.
const LOCATION_SEPARATOR: char = '#';

/// The layer an origin was written in (`Origin.layer`, the pattern
/// `^(api|shared|base|core|workspace|pack:[^#]+)$`).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Layer {
    /// `api`: the api's own files.
    Api,
    /// `shared`: the workspace's shared files.
    Shared,
    /// `base`: the base layer.
    Base,
    /// `core`: what the compiler adds.
    Core,
    /// `workspace`: the workspace file.
    Workspace,
    /// `pack:<name>`: a pack.
    Pack(PackName),
}

impl FromStr for Layer {
    type Err = IrError;

    fn from_str(text: &str) -> Result<Self, Self::Err> {
        match text {
            "api" => Ok(Self::Api),
            "shared" => Ok(Self::Shared),
            "base" => Ok(Self::Base),
            "core" => Ok(Self::Core),
            "workspace" => Ok(Self::Workspace),
            _ => pack_layer(text).ok_or_else(|| IrError::InvalidLayer {
                found: text.to_owned(),
            }),
        }
    }
}

fn pack_layer(text: &str) -> Option<Layer> {
    let name = text.strip_prefix(PACK_PREFIX)?;

    if name.is_empty() || name.contains(LOCATION_SEPARATOR) {
        return None;
    }

    Some(Layer::Pack(PackName::new(name.to_owned())))
}

impl fmt::Display for Layer {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Api => formatter.write_str("api"),
            Self::Shared => formatter.write_str("shared"),
            Self::Base => formatter.write_str("base"),
            Self::Core => formatter.write_str("core"),
            Self::Workspace => formatter.write_str("workspace"),
            Self::Pack(name) => write!(formatter, "{PACK_PREFIX}{name}"),
        }
    }
}

impl Serialize for Layer {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for Layer {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;

        text.parse().map_err(D::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_layer_reads_and_writes_its_text() {
        for text in [
            "api",
            "shared",
            "base",
            "core",
            "workspace",
            "pack:auth-kit",
        ] {
            let layer: Layer = text.parse().unwrap();

            assert_eq!(layer.to_string(), text);
        }
    }

    #[test]
    fn text_outside_the_pattern_is_refused() {
        for text in ["", "API", "pack:", "pack:a#b", "packs:a", "core "] {
            let refused = text.parse::<Layer>();

            assert!(
                matches!(&refused, Err(IrError::InvalidLayer { found }) if found == text),
                "{text:?}: {refused:?}"
            );
        }
    }
}
