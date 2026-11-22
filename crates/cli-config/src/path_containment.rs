//! Whether one resolved path lies under another, by their text: the config's paths are not real paths.

use camino::Utf8Path;

/// Whether `child` lies below `parent`, and is not `parent` itself.
pub(crate) fn is_strictly_inside(parent: &Utf8Path, child: &Utf8Path) -> bool {
    child != parent && is_inside_or_equal(parent, child)
}

/// Whether `child` is `parent` or lies below it.
pub(crate) fn is_inside_or_equal(parent: &Utf8Path, child: &Utf8Path) -> bool {
    child.starts_with(parent)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_sibling_named_like_a_prefix_is_not_inside_and_a_dot_dot_name_is() {
        let parent = Utf8Path::new("/out/app");

        assert!(!is_inside_or_equal(parent, Utf8Path::new("/out/app2")));
        assert!(is_strictly_inside(
            parent,
            Utf8Path::new("/out/app/..hidden")
        ));
        assert!(!is_strictly_inside(parent, parent));
    }
}
