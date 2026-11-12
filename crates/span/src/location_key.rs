use std::fmt::Display;

/// The side table key of one pointer of a layer, `<layer>#<pointer>` (ADR 0004 section 11).
#[must_use]
pub fn location_key(layer: &impl Display, pointer: &str) -> String {
    format!("{layer}#{pointer}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_key_joins_the_layer_and_the_pointer_with_a_hash() {
        assert_eq!(location_key(&"workspace", "/a/0"), "workspace#/a/0");
        assert_eq!(location_key(&"pack:shop", ""), "pack:shop#");
    }
}
