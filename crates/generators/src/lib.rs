//! The registry of every first-party generator of the binary.
//!
//! Each layer 3.4 family adds its `static` instances here; until then the registry is empty and
//! every first-party short id answers `config.target.not-built`.

use seampact_target::Registry;

/// Every first-party generator, in no meaningful order: a lookup is a scan by short id.
#[must_use]
pub fn registry() -> Registry {
    Registry::new(Vec::new())
}
