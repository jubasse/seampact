"""Reads an app config (ADR 0011 "The app config") as the Node CLI's `read-app-config.ts` does, with the same
problem codes: YAML, then the waiting keys, then `app.schema.json`, then the rules the schema cannot state. A
monorepo root config that lists the app is refused by name (`config.root.unsupported`), as on the JVM. Paths resolve
against the config's directory."""

import os
from typing import Final

from seampact.ir.binary.absolute_path import resolved
from seampact.ir.bundle.source import BundleSource, GitSource, Registry, RegistrySource, ReleaseSource
from seampact.ir.config.app_config import AppConfig, AppConfigEntry, LocalSource
from seampact.ir.config.config_kind import ConfigKind
from seampact.ir.config.config_path import is_at_or_below_directory, normalize_config_path, resolve_config_path
from seampact.ir.config.config_tree import ConfigTree
from seampact.ir.config.json_value import (
    JsonObject,
    bool_of,
    copy_of,
    has,
    list_of,
    object_copy_of,
    object_of,
    string_of,
    strings_of,
)
from seampact.ir.config.problem import ConfigProblem
from seampact.ir.config.schema_check import schema_problems
from seampact.ir.config.target_ecosystem import TargetEcosystem
from seampact.ir.config.waits import waiting_key_problems
from seampact.ir.config.yaml_reader import read_config_file
from seampact.ir.write.paths import case_folded

CONFIG_FILE_NAME: Final = "seampact.config.yaml"
_ROOT_CONFIG_MARKER_KEY: Final = "apps"
_DEFAULT_OUT_DIR: Final = "__generated__"
# The directory that ends the search for a root config: a repository's top, the first one holding `.git`.
_REPOSITORY_MARKER: Final = ".git"


def read_app_config(file: str, display_name: str | None = None) -> AppConfig | list[ConfigProblem]:
    """Reads the app config at `file`; `display_name` names it in problems (`file` itself by default)."""
    absolute = normalize_config_path(resolved(file))
    tree = read_config_file(absolute, display_name or file, ConfigKind.APP)

    if isinstance(tree, list):
        return tree

    if has(tree.value, _ROOT_CONFIG_MARKER_KEY):
        return [
            ConfigProblem(
                "config.root.not-an-app",
                f"This file is a monorepo root config (it holds `{_ROOT_CONFIG_MARKER_KEY}`), and the command runs on "
                "one app's config.",
                "Run the command in one of the apps the root config lists, or pass that app's config with `--config`.",
                tree.where_of([_ROOT_CONFIG_MARKER_KEY]),
            )
        ]

    problems = schema_problems(tree, ConfigKind.APP, waiting_key_problems(tree))

    if problems:
        return problems

    directory = os.path.dirname(absolute)
    root_problems = _listing_root_problems(directory)

    if root_problems:
        return root_problems

    if not isinstance(tree.value, dict):
        raise TypeError("seampact-ir: a value the app schema accepts is an object.")

    return _resolved(tree, absolute, tree.value)


def _resolved(tree: ConfigTree, file: str, config: JsonObject) -> AppConfig | list[ConfigProblem]:
    directory = os.path.dirname(file)
    out_dir = resolve_config_path(directory, string_of(config, "outDir") or _DEFAULT_OUT_DIR)
    entries: list[AppConfigEntry] = []

    for entry in list_of(config, "targets") or []:
        if isinstance(entry, dict):
            out = string_of(entry, "out") or string_of(entry, "id") or ""
            entries.append(AppConfigEntry(object_copy_of(entry), resolve_config_path(out_dir, out)))

    problems = [
        *_duplicate_id_problems(tree, entries),
        *_outside_out_dir_problems(tree, out_dir, entries),
        *_overlapping_out_problems(tree, entries),
        *_switched_off_allow_list_problems(tree, entries),
        *_framework_docs_conflict_problems(tree, entries),
    ]

    if problems:
        return problems

    sources = {
        name: _source_of(directory, source)
        for name, source in (object_of(config, "sources") or {}).items()
        if isinstance(source, dict)
    }
    own_entries = [entry for entry in entries if entry.ecosystem is TargetEcosystem.PYPI]
    other_entries = [entry for entry in entries if entry.ecosystem is not TargetEcosystem.PYPI]
    checks = object_of(config, "checks")
    warnings = object_of(config, "warnings")

    return AppConfig(
        tree.display_name,
        file,
        directory,
        out_dir,
        bool_of(config, "allowLocal"),
        sources,
        object_copy_of(object_of(config, "sources")),
        own_entries,
        other_entries,
        copy_of(config.get("openapi")),
        None if checks is None else object_copy_of(checks),
        None if warnings is None else object_copy_of(warnings),
    )


def _source_of(directory: str, source: JsonObject) -> LocalSource | BundleSource:
    path = string_of(source, "path")

    if path is not None:
        return LocalSource(resolve_config_path(directory, path))

    integrity = string_of(source, "integrity")
    release = object_of(source, "release")
    git = object_of(source, "git")
    maven = string_of(source, "maven")

    if release is not None:
        return ReleaseSource(string_of(release, "url") or "", integrity)

    if git is not None:
        return GitSource(
            string_of(git, "url") or "", string_of(git, "tag") or "", string_of(git, "directory"), integrity
        )

    if maven is not None:
        return RegistrySource(Registry.MAVEN, maven, integrity)

    name = f"{string_of(source, 'package') or ''}@{string_of(source, 'version') or ''}"

    return RegistrySource(Registry.NPM, name, integrity)


def _duplicate_id_problems(tree: ConfigTree, entries: list[AppConfigEntry]) -> list[ConfigProblem]:
    problems: list[ConfigProblem] = []
    seen: set[str] = set()

    for index, entry in enumerate(entries):
        if entry.id in seen:
            problems.append(
                ConfigProblem(
                    "config.target.duplicate-id",
                    f"Two target entries have the id '{entry.id}'.",
                    "Give each target entry its own id.",
                    tree.where_of(["targets", index, "id"]),
                )
            )

        seen.add(entry.id)

    return problems


def _outside_out_dir_problems(tree: ConfigTree, out_dir: str, entries: list[AppConfigEntry]) -> list[ConfigProblem]:
    return [
        ConfigProblem(
            "config.out.outside",
            f"The output directory of '{entry.id}' is not inside `outDir` ({out_dir}).",
            "Give `out` a relative path that stays inside `outDir`.",
            tree.where_of(["targets", index, "out"]),
        )
        for index, entry in enumerate(entries)
        if entry.root == out_dir or not is_at_or_below_directory(entry.root, out_dir)
    ]


def _overlapping_out_problems(tree: ConfigTree, entries: list[AppConfigEntry]) -> list[ConfigProblem]:
    """Two entries writing to the same directory, or one inside the other, would remove each other's files; so would
    two whose directories match once case is ignored, on a case-insensitive disk."""
    problems: list[ConfigProblem] = []

    for index, entry in enumerate(entries):
        for other in entries[index + 1 :]:
            problem = _overlapping_out_problem(tree, index, entry, other)

            if problem is not None:
                problems.append(problem)

    return problems


def _overlapping_out_problem(
    tree: ConfigTree, index: int, entry: AppConfigEntry, other: AppConfigEntry
) -> ConfigProblem | None:
    where = tree.where_of(["targets", index])

    if _is_nested_or_same(entry.root, other.root):
        return ConfigProblem(
            "config.out.overlap",
            f"The entries '{entry.id}' and '{other.id}' write to the same directory, or one inside the other.",
            "Give each entry its own `out` directory, side by side under `outDir`.",
            where,
        )

    if not _is_nested_or_same(case_folded(entry.root), case_folded(other.root)):
        return None

    return ConfigProblem(
        "config.out.case-overlap",
        f"The entries '{entry.id}' and '{other.id}' write to directories that are one, or one inside the other, "
        "once letter case is ignored, as a case-insensitive disk does.",
        "Give each entry an `out` directory whose name differs by more than letter case, side by side under `outDir`.",
        where,
    )


def _is_nested_or_same(first: str, second: str) -> bool:
    return is_at_or_below_directory(first, second) or is_at_or_below_directory(second, first)


def _switched_off_allow_list_problems(tree: ConfigTree, entries: list[AppConfigEntry]) -> list[ConfigProblem]:
    """An allow-list of a check switched off would be dropped without a word."""
    problems: list[ConfigProblem] = []

    for index, entry in enumerate(entries):
        switch = _framework_route_switch_off(entry.artefacts)

        if switch is not None and has(entry.entry, "frameworkRoutes"):
            problems.append(
                ConfigProblem(
                    "config.key.conflict",
                    f"The entry '{entry.id}' allow-lists framework routes in 'frameworkRoutes' but switches their "
                    f"check off with '{switch}: false'.",
                    "Keep one: remove 'frameworkRoutes' to leave the check off, or remove the switch to check the "
                    "routes against the allow-list.",
                    tree.where_of(["targets", index, "frameworkRoutes"]),
                )
            )

    return problems


def _framework_route_switch_off(artefacts: JsonObject) -> str | None:
    if bool_of(artefacts, "bootCheck") is False:
        return "artefacts.bootCheck"

    boot_check = object_of(artefacts, "bootCheck")

    if boot_check is not None and bool_of(boot_check, "frameworkRoutes") is False:
        return "artefacts.bootCheck.frameworkRoutes"

    return None


def _framework_docs_conflict_problems(tree: ConfigTree, entries: list[AppConfigEntry]) -> list[ConfigProblem]:
    """`frameworkDocs: off` asks for no framework document while `nativeDocs` completes one."""
    return [
        ConfigProblem(
            "config.key.conflict",
            f"The entry '{entry.id}' sets 'frameworkDocs: off' and 'artefacts.nativeDocs: true': one switches the "
            "framework's document off, the other completes it.",
            "Keep one: remove 'frameworkDocs: off' to complete the framework's document, or switch "
            "'artefacts.nativeDocs' off.",
            tree.where_of(["targets", index, "frameworkDocs"]),
        )
        for index, entry in enumerate(entries)
        if string_of(entry.entry, "frameworkDocs") == "off" and bool_of(entry.artefacts, "nativeDocs") is True
    ]


def _listing_root_problems(app_directory: str) -> list[ConfigProblem]:
    """A monorepo root config that lists this app is refused by name: folding a root's sources into an app waits for
    a Python app that needs it. The search is the Node CLI's: each ancestor up to the first holding `.git`; a root
    that does not list the app leaves it standing alone, and an ancestor config that does not read refuses it."""
    if os.path.lexists(os.path.join(app_directory, _REPOSITORY_MARKER)):
        return []

    directory = os.path.dirname(app_directory)
    previous = app_directory

    while directory != previous:
        candidate = os.path.join(directory, CONFIG_FILE_NAME)

        if os.path.exists(candidate):
            problems = _root_listing_problems(candidate, app_directory)

            if problems:
                return problems

        if os.path.lexists(os.path.join(directory, _REPOSITORY_MARKER)):
            return []

        previous = directory
        directory = os.path.dirname(directory)

    return []


def _root_listing_problems(candidate: str, app_directory: str) -> list[ConfigProblem]:
    tree = read_config_file(candidate, candidate, ConfigKind.ROOT)

    if isinstance(tree, list):
        return tree

    # A config holding `apps` is a root config, whatever the value: a malformed one refuses the app.
    if not has(tree.value, _ROOT_CONFIG_MARKER_KEY):
        return []

    schema = schema_problems(tree, ConfigKind.ROOT)

    if schema:
        return schema

    apps = strings_of(tree.value, _ROOT_CONFIG_MARKER_KEY)

    if apps is None:
        raise TypeError("seampact-ir: the root schema check passed an `apps` that is not a list of strings.")

    for app in apps:
        if resolve_config_path(os.path.dirname(candidate), app) == app_directory:
            return [
                ConfigProblem(
                    "config.root.unsupported",
                    f"The monorepo root config {candidate} lists this app ({app_directory}); a Python build does not "
                    "read a root config yet, it comes once a Python app needs one.",
                    "Define the app's sources in its own config and remove the app from the root config's `apps`, or "
                    "generate the app with the Node CLI.",
                    tree.where_of([_ROOT_CONFIG_MARKER_KEY]),
                )
            ]

    return []
