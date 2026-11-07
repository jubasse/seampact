"""A bundle source fetched from its channel and put through the pinned-bundle check, so its IR is read with no
compiler run (ADR 0011, as the Node runner's `fetch.ts`): a release asset over HTTPS or a git tag with the system
`git`. A fetched bundle is cached by its pinned integrity once it passed, and the check runs again on every cache
read. A `package` or `maven` source needs another ecosystem's registry and is refused by name, naming the forms of the
same bundle a Python build reads."""

import os
from pathlib import Path
from typing import Final

from seampact.ir.bundle.archive import read_bundle_archive
from seampact.ir.bundle.cache import BundleCache
from seampact.ir.bundle.channel import BundleChannel
from seampact.ir.bundle.directory import read_bundle_directory
from seampact.ir.bundle.failure import BundleFailure, BundleFailureCode
from seampact.ir.bundle.fetched import FetchedBundle
from seampact.ir.bundle.files import BundleFiles
from seampact.ir.bundle.git_fetch import GitFetch, git_source_problem
from seampact.ir.bundle.release_fetch import ReleaseFetch, release_source_problem
from seampact.ir.bundle.source import BundleSource, GitSource, Registry, RegistrySource, ReleaseSource
from seampact.ir.bundle.verifier import verify_bundle
from seampact.ir.config.json_value import JsonObject
from seampact.ir.config.local_source_policy import LocalSourcePolicy
from seampact.ir.read.parse import parse_json_value

# The codes of the pinned-bundle check's step 3 (`bundle.ir-version`, `bundle.ir-revision`...).
_IR_CHECK_CODE_PREFIX: Final = "bundle.ir-"
_OTHER_FORMS: Final = (
    "Use the same bundle as a release asset (`release: { url }`) or a git tag (`git: { url, tag, directory }`), "
    "with the same integrity."
)


class BundleFetcher:
    def __init__(self, cache_directory: str, release: ReleaseFetch, git: GitFetch) -> None:
        self._cache = BundleCache(cache_directory)
        self._release = release
        self._git = git

    def fetch(
        self, source: BundleSource, base_directory: str, local_sources: LocalSourcePolicy
    ) -> FetchedBundle | list[BundleFailure]:
        """Fetches and checks `source`; `base_directory` is where a local git path is relative to, and
        `local_sources` whether a local git repository may be fetched."""
        problem = self._source_problem(source, local_sources)

        if problem is not None:
            return [problem]

        channel = BundleChannel.GIT if isinstance(source, GitSource) else BundleChannel.RELEASE
        integrity = source.integrity
        entry = None if integrity is None else self._cache.entry_of(integrity)

        if entry is not None and os.path.isdir(entry):
            return _read_cache_entry(entry, integrity, channel)

        files = self._fetched_files(source, base_directory, local_sources)

        if isinstance(files, BundleFailure):
            return [files]

        verified = _verified(files, integrity, channel)

        if isinstance(verified, FetchedBundle) and entry is not None:
            self._cache.store(files, entry)

        return verified

    def verified_cache_entry(self, integrity: str) -> str | BundleFailure:
        """The cache entry of the bundle pinned by `integrity`, once it passes the pinned-bundle check again, so a
        host that hands the bundle over (the compiler binary's `--bundle-directory`) gets only a path just checked; an
        entry that is missing or fails the check is refused as `bundle.cache-invalid`, naming it."""
        entry = self._cache.entry_of(integrity)

        if entry is not None and os.path.isdir(entry) and not os.path.islink(entry):
            files = read_bundle_directory_path(entry)

            if not isinstance(files, BundleFailure) and verify_bundle(files, integrity, BundleChannel.RELEASE).ok:
                return entry

        named = entry or f"(no cache entry for {integrity})"

        return BundleFailure(
            BundleFailureCode.CACHE_INVALID,
            f"The cached bundle at {named} is gone or fails the pinned-bundle check since this run read it; it is not "
            "handed to the compiler binary.",
            "Pin the source with a `sha256-` integrity, then run again."
            if entry is None
            else f"Remove {entry}, then run again to fetch the bundle afresh.",
            entry,
        )

    @staticmethod
    def _source_problem(source: BundleSource, local_sources: LocalSourcePolicy) -> BundleFailure | None:
        if isinstance(source, RegistrySource):
            return _registry_unsupported(source)

        if isinstance(source, ReleaseSource):
            return release_source_problem(source)

        return git_source_problem(source, local_sources)

    def _fetched_files(
        self, source: BundleSource, base_directory: str, local_sources: LocalSourcePolicy
    ) -> BundleFiles | BundleFailure:
        if isinstance(source, GitSource):
            return self._git.fetch(source, base_directory, local_sources)

        if not isinstance(source, ReleaseSource):
            raise TypeError("seampact-ir: only release and git sources are fetched.")

        tarball = self._release.download(source)

        if isinstance(tarball, BundleFailure):
            return tarball

        # The archive reader refuses a tarball on its first problem.
        return read_bundle_archive(tarball)


def read_bundle_directory_path(directory: str) -> BundleFiles | BundleFailure:
    return read_bundle_directory(Path(directory))


def _verified(files: BundleFiles, integrity: str | None, channel: BundleChannel) -> FetchedBundle | list[BundleFailure]:
    verification = verify_bundle(files, integrity, channel)

    if not verification.ok or verification.manifest is None or verification.integrity is None:
        return list(verification.failures)

    # The bytes the check read, never the file again: a cache writer could swap it between the check and a read.
    documents: dict[str, JsonObject] = {}

    for api_name in sorted(verification.ir_bytes):
        parsed = parse_json_value(verification.ir_bytes[api_name].decode("utf-8"))

        if not isinstance(parsed, dict):
            raise TypeError(f"seampact-ir: the checked IR of api '{api_name}' does not parse again.")

        documents[api_name] = parsed

    return FetchedBundle(verification.integrity, documents)


def _read_cache_entry(entry: str, integrity: str | None, channel: BundleChannel) -> FetchedBundle | list[BundleFailure]:
    """A cache entry is checked again on every read; one whose files fail (steps 1-2) names itself, since only
    removing it heals it. An IR check failure (step 3) is on bytes that match the pin, so refetching gives the same
    failure."""
    files = read_bundle_directory_path(entry)

    if isinstance(files, BundleFailure):
        return [_cache_changed(entry), files]

    verified = _verified(files, integrity, channel)

    if isinstance(verified, FetchedBundle):
        return verified

    if all(failure.code.value.startswith(_IR_CHECK_CODE_PREFIX) for failure in verified):
        return verified

    return [_cache_changed(entry), *verified]


def _cache_changed(entry: str) -> BundleFailure:
    return BundleFailure(
        BundleFailureCode.CACHE_INVALID,
        f"The cached bundle at {entry} fails the pinned-bundle check; it was changed after it was cached.",
        f"Remove {entry}, then run again to fetch the bundle afresh.",
        entry,
    )


def _registry_unsupported(source: RegistrySource) -> BundleFailure:
    if source.registry is Registry.MAVEN:
        return BundleFailure(
            BundleFailureCode.MAVEN_JVM_ONLY,
            f"The bundle source {source.describe()} is a Maven artefact; only the JVM build plugins resolve Maven "
            "artefacts.",
            _OTHER_FORMS,
        )

    return BundleFailure(
        BundleFailureCode.PACKAGE_UNSUPPORTED,
        f"The bundle source {source.describe()} is an npm package; a Python build does not read the npm registry yet, "
        "it comes once a Python app needs it.",
        _OTHER_FORMS,
    )
