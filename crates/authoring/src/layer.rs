//! The layers a loaded file belongs to, their kinds and the authoring schema each is read as.

use std::fmt;

use seampact_ir::{Layer, PackName};

/// A layer of an api (ADR 0002 section 2): every origin layer but `workspace`, which only names
/// the entry file, and `core`, a declaration the compiler supplies with no file and no side-table
/// entry (ADR 0004 section 6).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum ApiLayer {
    /// `api`: the api's own files.
    Api,
    /// `shared`: the workspace's shared files.
    Shared,
    /// `base`: the base layer.
    Base,
    /// `pack:<name>`: a pack.
    Pack(PackName),
}

/// The kind of an api layer: a pack layer without its name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LayerKind {
    /// The `api` layer.
    Api,
    /// The `base` layer.
    Base,
    /// The `shared` layer.
    Shared,
    /// A `pack:<name>` layer.
    Pack,
}

/// A layer read from a file: a layer of an api, or the workspace entry file. Never `core`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum FileLayer {
    /// The workspace entry file, `workspace.yaml`.
    Workspace,
    /// A layer of an api.
    Api(ApiLayer),
}

/// The authoring schema a layer's document is read as by the load stage and validated as by
/// the validate stage: one mapping for both. The shared file is a base (ADR 0002 section 1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LayerSchemaKind {
    /// `workspace.schema.json`.
    Workspace,
    /// `api.schema.json`.
    Api,
    /// `base.schema.json`.
    Base,
    /// `pack.schema.json`.
    Pack,
}

impl ApiLayer {
    /// The kind of the layer.
    #[must_use]
    pub fn kind(&self) -> LayerKind {
        match self {
            Self::Api => LayerKind::Api,
            Self::Shared => LayerKind::Shared,
            Self::Base => LayerKind::Base,
            Self::Pack(_) => LayerKind::Pack,
        }
    }
}

impl LayerKind {
    /// The authoring schema a layer of this kind is read as.
    #[must_use]
    pub fn schema_kind(self) -> LayerSchemaKind {
        match self {
            Self::Api => LayerSchemaKind::Api,
            Self::Base | Self::Shared => LayerSchemaKind::Base,
            Self::Pack => LayerSchemaKind::Pack,
        }
    }
}

impl FileLayer {
    /// The authoring schema the layer's document is read and validated as.
    #[must_use]
    pub fn schema_kind_of(&self) -> LayerSchemaKind {
        match self {
            Self::Workspace => LayerSchemaKind::Workspace,
            Self::Api(layer) => layer.kind().schema_kind(),
        }
    }
}

impl From<ApiLayer> for Layer {
    fn from(layer: ApiLayer) -> Self {
        match layer {
            ApiLayer::Api => Self::Api,
            ApiLayer::Shared => Self::Shared,
            ApiLayer::Base => Self::Base,
            ApiLayer::Pack(name) => Self::Pack(name),
        }
    }
}

impl From<FileLayer> for Layer {
    fn from(layer: FileLayer) -> Self {
        match layer {
            FileLayer::Workspace => Self::Workspace,
            FileLayer::Api(api_layer) => api_layer.into(),
        }
    }
}

impl From<ApiLayer> for FileLayer {
    fn from(layer: ApiLayer) -> Self {
        Self::Api(layer)
    }
}

impl fmt::Display for ApiLayer {
    /// The layer id as an origin writes it: `api`, `shared`, `base` or `pack:<name>`.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        Layer::from(self.clone()).fmt(formatter)
    }
}

impl fmt::Display for FileLayer {
    /// The layer id as an origin writes it, `workspace` for the entry file.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        Layer::from(self.clone()).fmt(formatter)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pack(name: &str) -> ApiLayer {
        ApiLayer::Pack(PackName::new(name.to_owned()))
    }

    #[test]
    fn each_api_layer_has_its_kind() {
        assert_eq!(ApiLayer::Api.kind(), LayerKind::Api);
        assert_eq!(ApiLayer::Shared.kind(), LayerKind::Shared);
        assert_eq!(ApiLayer::Base.kind(), LayerKind::Base);
        assert_eq!(pack("auth-kit").kind(), LayerKind::Pack);
    }

    #[test]
    fn the_shared_file_is_read_as_a_base() {
        let expected = [
            (FileLayer::Workspace, LayerSchemaKind::Workspace),
            (FileLayer::Api(ApiLayer::Api), LayerSchemaKind::Api),
            (FileLayer::Api(ApiLayer::Shared), LayerSchemaKind::Base),
            (FileLayer::Api(ApiLayer::Base), LayerSchemaKind::Base),
            (FileLayer::Api(pack("auth-kit")), LayerSchemaKind::Pack),
        ];

        for (layer, schema_kind) in expected {
            assert_eq!(layer.schema_kind_of(), schema_kind, "{layer}");
        }
    }

    #[test]
    fn a_layer_converts_into_the_ir_layer_of_the_same_text() {
        let layers = [
            FileLayer::Workspace,
            FileLayer::Api(ApiLayer::Api),
            FileLayer::Api(ApiLayer::Shared),
            FileLayer::Api(ApiLayer::Base),
            FileLayer::Api(pack("auth-kit")),
            FileLayer::Api(pack("é-kit")),
        ];

        for layer in layers {
            let text = layer.to_string();
            let ir_layer = Layer::from(layer);

            assert_eq!(ir_layer.to_string(), text);
            assert_eq!(text.parse::<Layer>().ok(), Some(ir_layer));
        }
    }

    #[test]
    fn an_api_layer_writes_its_origin_text() {
        assert_eq!(ApiLayer::Api.to_string(), "api");
        assert_eq!(ApiLayer::Shared.to_string(), "shared");
        assert_eq!(ApiLayer::Base.to_string(), "base");
        assert_eq!(pack("auth-kit").to_string(), "pack:auth-kit");
        assert_eq!(FileLayer::Workspace.to_string(), "workspace");
    }
}
