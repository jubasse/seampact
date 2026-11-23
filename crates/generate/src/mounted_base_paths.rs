//! The base paths a server serves an api under.

use seampact_ir::ContractIr;

/// The api's mounted base paths, in surface order, each once; an api without a prefix or mount
/// gives `""`.
#[must_use]
pub fn mounted_base_paths(ir: &ContractIr, mount: &str) -> Vec<String> {
    let mut paths: Vec<String> = Vec::new();

    for surface in ir.api.surfaces.values() {
        let path = format!("{mount}{}", surface.prefix);

        if !paths.contains(&path) {
            paths.push(path);
        }
    }

    paths
}
