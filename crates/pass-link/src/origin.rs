//! The origin a diagnostic can carry: any origin but the `core` layer's.

use seampact_diagnostics::{DiagnosticLayer, DiagnosticOrigin};
use seampact_ir::{Layer, Origin};

/// The diagnostic origin of an IR origin, or `None` for the `core` layer, which has no file.
#[must_use]
pub fn diagnostic_origin_of(origin: &Origin) -> Option<DiagnosticOrigin> {
    let layer = match &origin.layer {
        Layer::Core => return None,
        Layer::Api => DiagnosticLayer::Api,
        Layer::Shared => DiagnosticLayer::Shared,
        Layer::Base => DiagnosticLayer::Base,
        Layer::Workspace => DiagnosticLayer::Workspace,
        Layer::Pack(name) => DiagnosticLayer::Pack(name.as_str().to_owned()),
    };

    Some(DiagnosticOrigin {
        layer,
        pointer: origin.pointer.clone(),
        api: origin.api.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn origin_in(layer: Layer) -> Origin {
        Origin {
            api: Some("tasks".to_owned()),
            layer,
            pointer: "/surfaces/a".to_owned(),
        }
    }

    #[test]
    fn a_core_origin_cannot_locate_a_diagnostic() {
        assert_eq!(diagnostic_origin_of(&origin_in(Layer::Core)), None);
    }

    #[test]
    fn any_other_layer_keeps_its_pointer_and_api() {
        let located = diagnostic_origin_of(&origin_in(Layer::Shared));

        assert_eq!(
            located,
            Some(DiagnosticOrigin {
                layer: DiagnosticLayer::Shared,
                pointer: "/surfaces/a".to_owned(),
                api: Some("tasks".to_owned()),
            })
        );
    }
}
