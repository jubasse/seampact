//! A bundle fetched from its source and verified.

use camino::Utf8PathBuf;
use indexmap::IndexMap;
use seampact_bundle::{BundleManifest, BundleSource};
use seampact_ir::ContractIr;

use crate::BundleFetchError;
use crate::not_ported::not_ported_yet;

/// Whether a local git repository (`file:` or a path) may be fetched.
///
/// Declared by the brief that ports `local-sources.ts`; uninhabited until then.
#[derive(Debug, Clone, PartialEq)]
pub enum LocalSourcePolicy {}

/// Why a bundle source cannot be fetched or verified.
///
/// Declared by the brief that ports `fetch-failure.ts`; uninhabited until then.
#[derive(Debug, Clone, PartialEq)]
pub enum BundleSourceFailure {}

/// The HTTPS get of the release channel; production answers through `ureq`, tests from records.
///
/// The brief that ports `fetch-release.ts` declares its method.
pub trait ReleaseGet {}

/// How bundles are fetched.
pub struct BundleFetchOptions<'run> {
    /// Where a `package` source is resolved from and a local git path is relative to.
    pub base_directory: Utf8PathBuf,
    /// Whether a local git repository may be fetched.
    pub local_sources: LocalSourcePolicy,
    /// The cache root; the default cache directory of the environment when absent.
    pub cache_directory: Option<Utf8PathBuf>,
    /// The HTTPS get of the release channel.
    pub release_get: &'run dyn ReleaseGet,
}

impl std::fmt::Debug for BundleFetchOptions<'_> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("BundleFetchOptions")
            .field("base_directory", &self.base_directory)
            .field("local_sources", &self.local_sources)
            .field("cache_directory", &self.cache_directory)
            .finish_non_exhaustive()
    }
}

/// A fetched and verified bundle, or the failures that stop it.
#[derive(Debug, Clone, PartialEq)]
pub enum BundleFetchResult {
    /// The bundle passed.
    Fetched {
        /// The `manifest` member.
        manifest: BundleManifest,
        /// The `integrity` member.
        integrity: String,
        /// Each api's IR by api name.
        irs: IndexMap<String, ContractIr>,
    },
    /// Why the bundle is refused.
    Failed {
        /// The `failures` member.
        failures: Vec<BundleSourceFailure>,
        /// The bundle's recomputed integrity, once its files passed: the value to pin.
        integrity: Option<String>,
    },
}

/// Fetches the bundle `source` names, through the cache, and verifies it.
///
/// # Errors
///
/// [`BundleFetchError::NotPortedYet`] until the function is ported.
pub fn fetch_bundle(
    _source: &BundleSource,
    _options: &BundleFetchOptions<'_>,
) -> Result<BundleFetchResult, BundleFetchError> {
    Err(not_ported_yet("fetchBundle"))
}
