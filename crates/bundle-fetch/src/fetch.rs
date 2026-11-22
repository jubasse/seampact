//! A bundle source fetched from its channel and put through the pinned-bundle check.
//!
//! The IR is read with no compiler run. A release or git bundle is cached by its pinned integrity
//! once it passed, and the check runs again on every cache read; an installed package is read
//! where it is, checked every time.

use camino::{Utf8Path, Utf8PathBuf};
use indexmap::IndexMap;
use seampact_bundle::{
    BundleArchiveExtraction, BundleChannel, BundleFailure, BundleManifest, BundleSource,
    BundleSourceForm, BundleVerifyResult, ReleaseBundleSource, extract_bundle_tarball,
    verify_bundle,
};
use seampact_diagnostics::InternalError;
use seampact_ir::ContractIr;

use crate::cache::{bundle_cache_entry, process_cache_directory, store_bundle_cache_entry};
use crate::fetch_git::fetch_git_bundle;
use crate::fetch_package::{InstalledPackage, installed_bundle_package};
use crate::fetch_release::{ReleaseTarball, download_release_tarball, release_source_problem};
use crate::fetched::{Fetched, FetchedRemoval};
use crate::git_source::git_source_problem;
use crate::release_get::ReleaseGet;
use crate::{BundleFetchError, BundleSourceFailure, BundleSourceFailureCode, LocalSourcePolicy};

/// The codes of the pinned-bundle check's IR step (`bundle.ir-version`, `bundle.ir-revision`...).
const IR_CHECK_CODE_PREFIX: &str = "bundle.ir-";

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

impl BundleFetchResult {
    fn refused(failure: BundleSourceFailure) -> Self {
        Self::Failed {
            failures: vec![failure],
            integrity: None,
        }
    }
}

impl From<BundleVerifyResult> for BundleFetchResult {
    fn from(result: BundleVerifyResult) -> Self {
        match result {
            BundleVerifyResult::Verified {
                manifest,
                integrity,
                irs,
            } => Self::Fetched {
                manifest,
                integrity,
                irs,
            },
            BundleVerifyResult::Failed {
                failures,
                integrity,
            } => Self::Failed {
                failures: failures
                    .into_iter()
                    .map(BundleSourceFailure::from)
                    .collect(),
                integrity,
            },
        }
    }
}

/// Fetches the bundle `source` names, through the cache, and verifies it.
///
/// # Errors
///
/// [`BundleFetchError::Io`] when a file, a directory or the cache cannot be read or written;
/// [`BundleFetchError::Internal`] for a bug.
pub fn fetch_bundle(
    source: &BundleSource,
    options: &BundleFetchOptions<'_>,
) -> Result<BundleFetchResult, BundleFetchError> {
    let integrity = source.integrity.as_deref();

    let (channel, problem) = match &source.form {
        BundleSourceForm::Maven(coordinate) => {
            return Ok(BundleFetchResult::refused(maven_jvm_only(coordinate)));
        }
        BundleSourceForm::Package(package) => {
            return match installed_bundle_package(package, &options.base_directory)? {
                InstalledPackage::Failed(failure) => Ok(BundleFetchResult::refused(failure)),
                InstalledPackage::Directory(directory) => {
                    verified(&directory, integrity, BundleChannel::Package)
                }
            };
        }
        BundleSourceForm::Release(release) => {
            (BundleChannel::Release, release_source_problem(release))
        }
        BundleSourceForm::Git(git) => (
            BundleChannel::Git,
            git_source_problem(git, options.local_sources),
        ),
    };

    if let Some(problem) = problem {
        return Ok(BundleFetchResult::refused(problem));
    }

    let cache_entry = match integrity {
        None => None,
        Some(pinned) => {
            let cache_directory = match &options.cache_directory {
                Some(configured) => configured.clone(),
                None => process_cache_directory()?,
            };

            bundle_cache_entry(&cache_directory, pinned)
        }
    };

    if let Some(entry) = cache_entry.as_deref().filter(|entry| entry.exists()) {
        return read_cache_entry(entry, integrity, channel);
    }

    let fetched = match &source.form {
        BundleSourceForm::Release(release) => fetch_release(release, options.release_get)?,
        BundleSourceForm::Git(git) => {
            fetch_git_bundle(git, &options.base_directory, options.local_sources)?
        }
        BundleSourceForm::Package(_) | BundleSourceForm::Maven(_) => {
            return Err(InternalError::new(
                "bundle: a package or Maven source reached the release and git channels."
                    .to_owned(),
            )
            .into());
        }
    };
    let (directory, _removal) = match fetched {
        Fetched::Failed(failure) => return Ok(BundleFetchResult::refused(failure)),
        Fetched::Directory { directory, removal } => (directory, removal),
    };
    let result = verified(&directory, integrity, channel)?;

    if let (BundleFetchResult::Fetched { .. }, Some(entry)) = (&result, &cache_entry) {
        store_bundle_cache_entry(&directory, entry)?;
    }

    Ok(result)
}

fn verified(
    directory: &Utf8Path,
    integrity: Option<&str>,
    channel: BundleChannel,
) -> Result<BundleFetchResult, BundleFetchError> {
    Ok(verify_bundle(directory, integrity, Some(channel))?.into())
}

/// A Maven artefact is resolved through a JVM build's own repositories, which the Node CLI has not.
fn maven_jvm_only(coordinate: &str) -> BundleSourceFailure {
    BundleSourceFailure::new(
        BundleSourceFailureCode::MavenJvmOnly,
        format!(
            "The bundle source Maven artefact '{coordinate}' is read by the Gradle and Maven plugins only; the Node CLI does not resolve Maven artefacts."
        ),
        "Point this source at the same bundle as a release URL (`release: { url }`), a git tag (`git: { url, tag, directory }`) or an npm package (`package`, `version`), with the same integrity.",
    )
}

fn fetch_release(
    source: &ReleaseBundleSource,
    get: &dyn ReleaseGet,
) -> Result<Fetched, BundleFetchError> {
    let tarball = match download_release_tarball(source, get) {
        ReleaseTarball::Failed(failure) => return Ok(Fetched::Failed(failure)),
        ReleaseTarball::Bytes(bytes) => bytes,
    };

    match extract_bundle_tarball(&tarball)? {
        BundleArchiveExtraction::Refused(failures) => Ok(Fetched::Failed(first_failure(failures)?)),
        BundleArchiveExtraction::Extracted(extracted) => Ok(Fetched::Directory {
            directory: extracted.path().to_owned(),
            removal: FetchedRemoval::Extracted(extracted),
        }),
    }
}

fn first_failure(failures: Vec<BundleFailure>) -> Result<BundleSourceFailure, InternalError> {
    failures
        .into_iter()
        .next()
        .map(BundleSourceFailure::from)
        .ok_or_else(|| {
            InternalError::new(
                "bundle: the archive reader refused a tarball without a failure.".to_owned(),
            )
        })
}

/// Verifies a cached bundle again; a failure other than the IR step's means it was changed after
/// it was cached.
fn read_cache_entry(
    entry: &Utf8Path,
    integrity: Option<&str>,
    channel: BundleChannel,
) -> Result<BundleFetchResult, BundleFetchError> {
    let verified = verified(entry, integrity, channel)?;
    let BundleFetchResult::Failed {
        failures,
        integrity,
    } = verified
    else {
        return Ok(verified);
    };

    if failures
        .iter()
        .all(|failure| failure.code.as_str().starts_with(IR_CHECK_CODE_PREFIX))
    {
        return Ok(BundleFetchResult::Failed {
            failures,
            integrity,
        });
    }

    let invalid = BundleSourceFailure::new(
        BundleSourceFailureCode::CacheInvalid,
        format!(
            "The cached bundle at {entry} fails the pinned-bundle check; it was changed after it was cached."
        ),
        &format!("Remove {entry}, then run again to fetch the bundle afresh."),
    )
    .about(entry.as_str());

    Ok(BundleFetchResult::Failed {
        failures: std::iter::once(invalid).chain(failures).collect(),
        integrity,
    })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::io::Cursor;
    use std::time::Duration;

    use seampact_bundle::BundleFailureCode;
    use url::Url;

    use super::*;
    use crate::release_get::{ReleaseGetError, ReleaseResponse};

    const PIN: &str = "sha256-m1Dx5GL/JzlteMx5ojBeXbRHBV8Wx7YgA3+v5h4xLDs=";
    const PIN_ENTRY: &str =
        "bundles/sha256-9b50f1e462ff27396d78cc79a2305e5db447055f16c7b620037fafe61e312c3b";

    /// Answers every request with the same body.
    struct FixedBody(Vec<u8>);

    impl ReleaseGet for FixedBody {
        fn get(&self, _url: &Url, _timeout: Duration) -> Result<ReleaseResponse, ReleaseGetError> {
            Ok(ReleaseResponse {
                status: 200,
                location: None,
                body: Box::new(Cursor::new(self.0.clone())),
            })
        }
    }

    fn source(form: BundleSourceForm, integrity: Option<&str>) -> BundleSource {
        BundleSource {
            form,
            integrity: integrity.map(str::to_owned),
        }
    }

    fn fetch(source: &BundleSource, cache: &Utf8Path, get: &dyn ReleaseGet) -> BundleFetchResult {
        let options = BundleFetchOptions {
            base_directory: cache.to_path_buf(),
            local_sources: LocalSourcePolicy::Refuse,
            cache_directory: Some(cache.join("cache")),
            release_get: get,
        };

        fetch_bundle(source, &options).unwrap()
    }

    fn codes(result: &BundleFetchResult) -> Vec<&'static str> {
        match result {
            BundleFetchResult::Failed { failures, .. } => failures
                .iter()
                .map(|failure| failure.code.as_str())
                .collect(),
            BundleFetchResult::Fetched { .. } => Vec::new(),
        }
    }

    #[test]
    fn a_maven_source_is_left_to_the_jvm_plugins() {
        let directory = tempfile::tempdir().unwrap();
        let cache = Utf8Path::from_path(directory.path()).unwrap();
        let result = fetch(
            &source(
                BundleSourceForm::Maven("org.example:notes:1.0.0".to_owned()),
                None,
            ),
            cache,
            &FixedBody(Vec::new()),
        );

        assert_eq!(codes(&result), ["bundle.maven-jvm-only"]);
    }

    #[test]
    fn a_release_that_is_not_https_is_refused_before_any_request() {
        let directory = tempfile::tempdir().unwrap();
        let cache = Utf8Path::from_path(directory.path()).unwrap();
        let release = BundleSourceForm::Release(ReleaseBundleSource {
            url: "http://h/x.tgz".to_owned(),
        });

        assert_eq!(
            codes(&fetch(
                &source(release, None),
                cache,
                &FixedBody(Vec::new())
            )),
            ["bundle.release-url"]
        );
    }

    #[test]
    fn a_release_that_is_no_tarball_gives_the_archive_readers_first_failure() {
        let directory = tempfile::tempdir().unwrap();
        let cache = Utf8Path::from_path(directory.path()).unwrap();
        let release = BundleSourceForm::Release(ReleaseBundleSource {
            url: "https://h/x.tgz".to_owned(),
        });
        let result = fetch(
            &source(release, Some(PIN)),
            cache,
            &FixedBody(b"not a tarball".to_vec()),
        );

        assert_eq!(codes(&result), [BundleFailureCode::ArchiveInvalid.as_str()]);
        assert!(
            !cache.join("cache").join(PIN_ENTRY).exists(),
            "nothing is cached"
        );
    }

    #[test]
    fn a_cache_entry_changed_after_it_was_cached_is_reported_then_checked() {
        let directory = tempfile::tempdir().unwrap();
        let cache = Utf8Path::from_path(directory.path()).unwrap();
        let entry = cache.join("cache").join(PIN_ENTRY);

        fs::create_dir_all(&entry).unwrap();

        let release = BundleSourceForm::Release(ReleaseBundleSource {
            url: "https://h/x.tgz".to_owned(),
        });
        let result = fetch(&source(release, Some(PIN)), cache, &FixedBody(Vec::new()));
        let BundleFetchResult::Failed { failures, .. } = &result else {
            panic!("an empty cache entry fails the check");
        };

        assert_eq!(
            codes(&result),
            [
                "bundle.cache-invalid",
                BundleFailureCode::ManifestMissing.as_str()
            ]
        );
        assert_eq!(
            failures.first().and_then(|failure| failure.file.as_deref()),
            Some(entry.as_str())
        );
    }
}
