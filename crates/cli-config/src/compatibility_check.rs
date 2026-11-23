//! The check of an app's entries against the compatibility matrix: the installed framework and
//! library versions each target was tested on.

use camino::Utf8Path;
use indexmap::IndexMap;
use seampact_diagnostics::InternalError;
use seampact_json::{object_of, text_of};
use seampact_target::{
    CompatibilityKey, CompatibilityMatrix, Generator, LibrarySupport, TargetCompatibility,
    supported_majors_of,
};

use crate::artefact_switches::{ArtefactSelection, select_artefacts};
use crate::check_level::MatrixCheckLevel;
use crate::installed_version::{
    FRAMEWORK_MISSING_CODE, InstalledPackageRole, InstalledVersion, InstalledVersionOutcome,
    read_installed_version,
};
use crate::package_manager::{DependencyKind, install_fix};
use crate::target_entry_settings::TargetEntrySettings;
use crate::{CliConfigError, CliProblem, LoadedAppConfig, entry_where, located_problem};

/// The artefact whose own validators import their library, as `OWN_VALIDATORS_ARTEFACT` of the
/// node-server boundary files.
const OWN_VALIDATORS_ARTEFACT: &str = "validators";

/// What the check finds: problems at the `error` level of `checks.matrix`, warnings otherwise.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CompatibilityOutcome {
    /// What fails the run.
    pub problems: Vec<CliProblem>,
    /// What the run reports and goes on.
    pub warnings: Vec<CliProblem>,
}

/// What `check_compatibility` reads: the entries, their resolved targets and installed versions.
#[derive(Debug)]
pub struct CompatibilityInput<'input> {
    /// The target entries, in order.
    pub entries: &'input [TargetEntrySettings],
    /// The resolved generator of each entry, by entry id.
    pub targets: &'input IndexMap<String, &'static dyn Generator>,
    /// The installed version of the framework package of each entry, by entry id.
    pub installed_versions: &'input IndexMap<String, InstalledVersion>,
    /// The installed version of each library the entry's switched-on artefacts import, by entry id.
    pub installed_libraries: &'input IndexMap<String, Vec<InstalledVersion>>,
    /// The compatibility data.
    pub matrix: &'input CompatibilityMatrix,
    /// How an untested major is reported.
    pub level: MatrixCheckLevel,
}

/// The majors a framework or a library is tested on.
struct TestedSubject<'subject> {
    id: &'subject str,
    tested_majors: &'subject [u32],
}

/// Reads each entry's installed framework version from its output directory, where the generated
/// code resolves its imports, then checks the app against `matrix`; `targets` is the resolved
/// generator of each entry, by entry id.
///
/// # Errors
///
/// [`CliConfigError::Internal`] when an entry has no resolved target, [`CliConfigError::Io`] when
/// a `package.json` cannot be read.
pub fn check_app_compatibility(
    config: &LoadedAppConfig,
    targets: &IndexMap<String, &'static dyn Generator>,
    matrix: &CompatibilityMatrix,
) -> Result<CompatibilityOutcome, CliConfigError> {
    let configured = config.target_entries()?;
    let mut installed_versions = IndexMap::new();
    let mut installed_libraries = IndexMap::new();
    let mut problems = Vec::new();

    for each in &configured {
        let entry = &each.settings;
        let Some(record) = matrix_record_of(entry, targets, matrix)? else {
            continue;
        };
        let where_ = entry_where(&entry.id, None);

        match read_installed_version(
            &each.root,
            &record.framework.package,
            InstalledPackageRole::Framework,
            &where_,
        )? {
            InstalledVersionOutcome::Refused(problem) => problems.push(problem),
            InstalledVersionOutcome::Installed(installed) => {
                installed_versions.insert(entry.id.clone(), installed);
            }
        }

        let mut libraries = Vec::new();

        for library in libraries_in_use(entry, targets, record)? {
            match read_installed_version(
                &each.root,
                &library.package,
                InstalledPackageRole::Library,
                &where_,
            )? {
                InstalledVersionOutcome::Refused(problem) => problems.push(problem),
                InstalledVersionOutcome::Installed(installed) => libraries.push(installed),
            }
        }

        installed_libraries.insert(entry.id.clone(), libraries);
        problems.extend(own_validators_library_problems(
            entry, targets, record, &each.root,
        )?);
    }

    if !problems.is_empty() {
        return Ok(CompatibilityOutcome {
            problems,
            warnings: Vec::new(),
        });
    }

    let entries: Vec<TargetEntrySettings> =
        configured.into_iter().map(|each| each.settings).collect();

    Ok(check_compatibility(&CompatibilityInput {
        entries: &entries,
        targets,
        installed_versions: &installed_versions,
        installed_libraries: &installed_libraries,
        matrix,
        level: config.checks()?.matrix.unwrap_or_default(),
    })?)
}

/// Checks each entry's installed framework and library versions against the matrix.
///
/// # Errors
///
/// [`InternalError`] when an entry has no resolved target, no installed version or no library
/// record for an installed library.
pub fn check_compatibility(
    input: &CompatibilityInput<'_>,
) -> Result<CompatibilityOutcome, InternalError> {
    let mut outcome = CompatibilityOutcome::default();

    for entry in input.entries {
        let Some(record) = matrix_record_of(entry, input.targets, input.matrix)? else {
            outcome.problems.extend(unrecorded_target_problems(entry));

            continue;
        };
        let installed = input.installed_versions.get(&entry.id).ok_or_else(|| {
            InternalError::new(format!(
                "no installed version of {} for the entry {}",
                record.framework.package, entry.id
            ))
        })?;

        check_entry(entry, record, installed, input.level, &mut outcome);

        for library in input
            .installed_libraries
            .get(&entry.id)
            .map_or(&[][..], Vec::as_slice)
        {
            check_library(entry, record, library, input.level, &mut outcome)?;
        }
    }

    Ok(outcome)
}

fn check_entry(
    entry: &TargetEntrySettings,
    record: &TargetCompatibility,
    installed: &InstalledVersion,
    level: MatrixCheckLevel,
    outcome: &mut CompatibilityOutcome,
) {
    let framework = &record.framework;
    let allowed = &entry.allow_untested;

    outcome.problems.extend(foreign_framework_problems(
        entry,
        &known_ids(record),
        &framework.id,
        allowed,
    ));
    outcome
        .warnings
        .extend(tested_major_warnings(entry, record, allowed));

    let incompatible = framework
        .incompatible
        .iter()
        .find(|each| u64::from(each.major) == installed.major);

    if let Some(incompatible) = incompatible {
        outcome.problems.push(located_problem(
            "config.matrix.incompatible",
            format!(
                "{} {} is installed, and the target '{}' does not work on {} {}: {}",
                framework.package,
                installed.version,
                entry.use_name,
                framework.id,
                installed.major,
                incompatible.reason
            ),
            &format!(
                "Install a major of {} the target is tested on: {}.",
                framework.package,
                tested_majors_text(record)
            ),
            entry_where(&entry.id, None),
        ));

        return;
    }

    let tested_majors = supported_majors_of(record);

    report_untested_major(
        entry,
        &TestedSubject {
            id: &framework.id,
            tested_majors: &tested_majors,
        },
        installed,
        level,
        outcome,
    );
}

fn check_library(
    entry: &TargetEntrySettings,
    record: &TargetCompatibility,
    installed: &InstalledVersion,
    level: MatrixCheckLevel,
    outcome: &mut CompatibilityOutcome,
) -> Result<(), InternalError> {
    let library = record
        .libraries
        .iter()
        .flatten()
        .find(|each| each.package == installed.package_name)
        .ok_or_else(|| {
            InternalError::new(format!(
                "no library record {} for the entry {}",
                installed.package_name, entry.id
            ))
        })?;

    report_untested_major(
        entry,
        &TestedSubject {
            id: &library.id,
            tested_majors: &library.tested_majors,
        },
        installed,
        level,
        outcome,
    );

    Ok(())
}

/// The `allowUntested` item that accepts `installed`: its major, or its minor for a 0.x version.
fn allow_untested_item_of(framework_id: &str, installed: &InstalledVersion) -> String {
    if installed.major != 0 {
        return format!("{framework_id}@{}", installed.major);
    }

    let minor: String = installed
        .version
        .split('.')
        .nth(1)
        .unwrap_or_default()
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();

    if minor.is_empty() {
        return format!("{framework_id}@0.<minor>");
    }

    format!("{framework_id}@0.{minor}")
}

fn tested_on_of(subject: &TestedSubject<'_>) -> String {
    if subject.tested_majors.is_empty() {
        return format!("tested on no {} major yet", subject.id);
    }

    format!(
        "tested on {} {} only",
        subject.id,
        majors_text(subject.tested_majors)
    )
}

fn majors_text(majors: &[u32]) -> String {
    let texts: Vec<String> = majors.iter().map(u32::to_string).collect();

    texts.join(", ")
}

fn report_untested_major(
    entry: &TargetEntrySettings,
    subject: &TestedSubject<'_>,
    installed: &InstalledVersion,
    level: MatrixCheckLevel,
    outcome: &mut CompatibilityOutcome,
) {
    let allow_item = allow_untested_item_of(subject.id, installed);
    let is_tested = subject
        .tested_majors
        .iter()
        .any(|major| u64::from(*major) == installed.major);

    if is_tested || entry.allow_untested.contains(&allow_item) {
        return;
    }

    let untested = located_problem(
        "config.matrix.untested",
        format!(
            "{} {} is installed, and the target '{}' is {}.",
            installed.package_name,
            installed.version,
            entry.use_name,
            tested_on_of(subject)
        ),
        &format!(
            "Install a tested major, or accept this one with `allowUntested: [{allow_item}]` on the entry."
        ),
        entry_where(&entry.id, None),
    );

    match level {
        MatrixCheckLevel::Error => outcome.problems.push(untested),
        MatrixCheckLevel::Warning => outcome.warnings.push(untested),
    }
}

fn foreign_framework_problems(
    entry: &TargetEntrySettings,
    known_framework_ids: &[&str],
    framework_id: &str,
    allowed: &[String],
) -> Vec<CliProblem> {
    allowed
        .iter()
        .filter(|item| !known_framework_ids.contains(&framework_id_of(item)))
        .map(|item| {
            located_problem(
                "config.matrix.unknown-framework",
                format!(
                    "The `allowUntested` item '{item}' names the framework '{}', and the target '{}' serves '{framework_id}'.",
                    framework_id_of(item),
                    entry.use_name
                ),
                &format!("Write the item as '{framework_id}@<major>', or remove it."),
                entry_where(&entry.id, None),
            )
        })
        .collect()
}

fn tested_major_warnings(
    entry: &TargetEntrySettings,
    record: &TargetCompatibility,
    allowed: &[String],
) -> Vec<CliProblem> {
    let framework_items = supported_majors_of(record)
        .into_iter()
        .map(|major| format!("{}@{major}", record.framework.id));
    let library_items = record.libraries.iter().flatten().flat_map(|library| {
        library
            .tested_majors
            .iter()
            .map(|major| format!("{}@{major}", library.id))
    });
    let tested_items: Vec<String> = framework_items.chain(library_items).collect();

    allowed
        .iter()
        .filter(|item| tested_items.contains(item))
        .map(|item| {
            located_problem(
                "config.matrix.allowed-tested",
                format!(
                    "The `allowUntested` item '{item}' names a major the compatibility matrix tests the target '{}' on, so it accepts nothing.",
                    entry.use_name
                ),
                &format!("Remove '{item}' from the entry's `allowUntested`."),
                entry_where(&entry.id, None),
            )
        })
        .collect()
}

fn unrecorded_target_problems(entry: &TargetEntrySettings) -> Vec<CliProblem> {
    if entry.allow_untested.is_empty() {
        return Vec::new();
    }

    vec![located_problem(
        "config.matrix.unrecorded-target",
        format!(
            "The compatibility matrix records no framework for the target '{}', so `allowUntested` has nothing to accept.",
            entry.use_name
        ),
        "Remove `allowUntested` from the entry.",
        entry_where(&entry.id, None),
    )]
}

fn target_of<'targets>(
    entry: &TargetEntrySettings,
    targets: &'targets IndexMap<String, &'static dyn Generator>,
) -> Result<&'targets dyn Generator, InternalError> {
    targets
        .get(&entry.id)
        .copied()
        .ok_or_else(|| InternalError::new(format!("no resolved target for the entry {}", entry.id)))
}

fn libraries_in_use<'matrix>(
    entry: &TargetEntrySettings,
    targets: &IndexMap<String, &'static dyn Generator>,
    record: &'matrix TargetCompatibility,
) -> Result<Vec<&'matrix LibrarySupport>, CliConfigError> {
    let target = target_of(entry, targets)?;
    let ArtefactSelection::Selected(artefacts) = select_artefacts(entry, target)? else {
        return Ok(Vec::new());
    };

    Ok(record
        .libraries
        .iter()
        .flatten()
        .filter(|library| artefacts.contains(&library.artefact) && is_selected(entry, library))
        .collect())
}

fn is_selected(entry: &TargetEntrySettings, library: &LibrarySupport) -> bool {
    let Some(selector) = &library.selected_by else {
        return true;
    };
    let written =
        object_of(entry.options.as_ref()).and_then(|options| options.get(&selector.option));

    text_of(written) == Some(selector.value.as_str())
}

fn own_validators_library_problems(
    entry: &TargetEntrySettings,
    targets: &IndexMap<String, &'static dyn Generator>,
    record: &TargetCompatibility,
    root: &Utf8Path,
) -> Result<Vec<CliProblem>, CliConfigError> {
    let Some(own_validator) = record.own_validators.first() else {
        return Ok(Vec::new());
    };
    let target = target_of(entry, targets)?;

    if entry.link.contains_key("validators") {
        return Ok(Vec::new());
    }

    let ArtefactSelection::Selected(artefacts) = select_artefacts(entry, target)? else {
        return Ok(Vec::new());
    };

    if !artefacts.contains(OWN_VALIDATORS_ARTEFACT) {
        return Ok(Vec::new());
    }

    let where_ = entry_where(&entry.id, None);
    let problem = match read_installed_version(
        root,
        &own_validator.library,
        InstalledPackageRole::ValidatorLibrary,
        &where_,
    )? {
        InstalledVersionOutcome::Installed(_) => return Ok(Vec::new()),
        InstalledVersionOutcome::Refused(problem) => problem,
    };

    if problem.code != FRAMEWORK_MISSING_CODE {
        return Ok(vec![problem]);
    }

    Ok(vec![located_problem(
        "config.own-validators.library-missing",
        format!(
            "The target '{}' writes its own validators, which import '{}', and it is not installed in the project of the entry's output directory ({root}).",
            entry.use_name, own_validator.library
        ),
        &install_fix(root, &own_validator.library, DependencyKind::Runtime)?,
        where_,
    )])
}

fn known_ids(record: &TargetCompatibility) -> Vec<&str> {
    std::iter::once(record.framework.id.as_str())
        .chain(
            record
                .libraries
                .iter()
                .flatten()
                .map(|library| library.id.as_str()),
        )
        .collect()
}

/// The record the matrix holds for the entry's target; none for a target the matrix does not
/// record.
fn matrix_record_of<'matrix>(
    entry: &TargetEntrySettings,
    targets: &IndexMap<String, &'static dyn Generator>,
    matrix: &'matrix CompatibilityMatrix,
) -> Result<Option<&'matrix TargetCompatibility>, InternalError> {
    let target = target_of(entry, targets)?;
    let Some(key) = target.metadata().compatibility else {
        return Ok(None);
    };
    let package = match key {
        CompatibilityKey::Server(package) | CompatibilityKey::Client(package) => package,
    };

    Ok(matrix
        .all_targets()
        .find(|record| record.package == package))
}

fn tested_majors_text(record: &TargetCompatibility) -> String {
    majors_text(&supported_majors_of(record))
}

/// The framework of an `allowUntested` item: the text before its last `@`, all but the last
/// character when it has none, as `slice(0, lastIndexOf("@"))` does.
fn framework_id_of(item: &str) -> &str {
    if let Some(at) = item.rfind('@') {
        return item.get(..at).unwrap_or_default();
    }

    item.char_indices()
        .next_back()
        .map_or("", |(last, _)| item.get(..last).unwrap_or_default())
}
