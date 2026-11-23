//! The per-target capability data of `spec/compatibility`: tested framework majors, libraries,
//! validator and client styles, the first-party providers.

use serde::Deserialize;

use crate::{LinkKind, LinkStyle};

/// The JSON of `spec/compatibility/matrix.json`, compiled in.
const MATRIX_JSON: &str = include_str!("../../../packages/core/spec/compatibility/matrix.json");

/// The JSON of `spec/compatibility/python-targets.json`, compiled in.
const PYTHON_TARGETS_JSON: &str =
    include_str!("../../../packages/core/spec/compatibility/python-targets.json");

/// Why the compatibility data cannot be read, or holds no record a caller asked for.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CompatibilityError {
    /// A data file does not parse into its shape.
    #[error("compatibility: {file} is malformed: {message}")]
    Malformed {
        /// The file name.
        file: &'static str,
        /// The parser's message.
        message: String,
    },
    /// A record's value is not one the data allows.
    #[error("compatibility: matrix.json {message}")]
    Invalid {
        /// What is wrong.
        message: String,
    },
    /// No record of the asked role names the package.
    #[error(
        "compatibility: '{package}' is not a {role} target of the matrix; recorded: {recorded}."
    )]
    NotRecorded {
        /// `server` or `client`.
        role: &'static str,
        /// The package asked for.
        package: String,
        /// The recorded packages of that role.
        recorded: String,
    },
}

/// A target's record in the compatibility data.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CompatibilityKey {
    /// A `serverTargets` record, by its package.
    Server(&'static str),
    /// A `clientTargets` record, by its package.
    Client(&'static str),
}

/// A first-party provider of a link kind.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Deserialize)]
pub struct FirstPartyProvider {
    /// The provider's short id.
    pub id: String,
    /// Its 1.x package.
    pub package: String,
    /// The kind it provides.
    pub kind: LinkKind,
    /// The style it writes.
    pub style: LinkStyle,
}

/// A validator a server target writes with its own library.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Deserialize)]
pub struct OwnValidator {
    /// The validator id.
    pub id: String,
    /// The library.
    pub library: String,
}

/// A framework major a consumer tests.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Deserialize)]
pub struct TestedMajor {
    /// The major.
    pub major: u32,
    /// The consumer that tests it.
    pub consumer: String,
}

/// A framework major the target cannot serve.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Deserialize)]
pub struct IncompatibleMajor {
    /// The major.
    pub major: u32,
    /// Why.
    pub reason: String,
}

/// The framework a target generates for, and its tested majors.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Deserialize)]
pub struct FrameworkSupport {
    /// The framework id.
    pub id: String,
    /// The framework's package.
    pub package: String,
    /// The tested majors.
    pub tested: Vec<TestedMajor>,
    /// The incompatible majors.
    pub incompatible: Vec<IncompatibleMajor>,
    /// The `<major>.<minor>` floor of a PHP framework.
    #[serde(default)]
    pub floor: Option<String>,
}

/// A library one of a target's artefacts imports.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySupport {
    /// The library id.
    pub id: String,
    /// Its package.
    pub package: String,
    /// The artefact that imports it.
    pub artefact: String,
    /// The tested majors.
    pub tested_majors: Vec<u32>,
    /// The option value that selects it, when the artefact can use another library.
    #[serde(default)]
    pub selected_by: Option<LibrarySelector>,
}

/// The option and value that select a library.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Deserialize)]
pub struct LibrarySelector {
    /// The option name.
    pub option: String,
    /// The value.
    pub value: String,
}

/// A Node server or client target's record.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetCompatibility {
    /// The target's 1.x package.
    pub package: String,
    /// Its framework.
    pub framework: FrameworkSupport,
    /// The libraries its artefacts import.
    #[serde(default)]
    pub libraries: Option<Vec<LibrarySupport>>,
    /// The validator styles it reads.
    pub validator_styles: Vec<LinkStyle>,
    /// The validators it writes with its own library.
    pub own_validators: Vec<OwnValidator>,
    /// The client styles a client target reads; empty for a server target.
    #[serde(default)]
    pub client_styles: Vec<LinkStyle>,
}

/// A JVM or PHP target's record.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Deserialize)]
pub struct NativeTargetCompatibility {
    /// The target's 1.x package.
    pub package: String,
    /// Its framework.
    pub framework: FrameworkSupport,
}

/// A Python framework or companion and its tested versions.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PythonFrameworkSupport {
    /// The framework id.
    pub id: String,
    /// Its distribution.
    pub package: String,
    /// Whether `tested` lists majors or minors.
    pub unit: PythonVersionUnit,
    /// The lowest version.
    pub floor: String,
    /// The tested versions.
    pub tested: Vec<String>,
    /// The tested minors, when `tested` lists majors.
    #[serde(default)]
    pub tested_minors: Option<Vec<String>>,
    /// The incompatible versions.
    pub incompatible: Vec<PythonIncompatible>,
}

/// The unit a Python framework's versions are tested by.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PythonVersionUnit {
    /// Majors.
    Major,
    /// Minors.
    Minor,
}

/// A Python version the target cannot serve.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Deserialize)]
pub struct PythonIncompatible {
    /// The version.
    pub unit: String,
    /// Why.
    pub reason: String,
}

/// A Python target's record.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Deserialize)]
pub struct PythonTargetCompatibility {
    /// The target's 1.x distribution.
    pub package: String,
    /// Its framework.
    pub framework: PythonFrameworkSupport,
    /// The libraries it runs on beside the framework.
    pub companions: Vec<PythonFrameworkSupport>,
}

/// A framework, validator and consumer the matrix offers together.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ValidatorPair {
    /// The server target's package.
    pub target: String,
    /// The framework's package.
    pub framework: String,
    /// The framework major.
    pub framework_major: u32,
    /// The consumer testing it.
    pub consumer: String,
    /// The validator id.
    pub validator: String,
    /// The validator's package.
    pub validator_package: String,
}

/// The capability data, parsed once per run and passed by reference.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompatibilityMatrix {
    /// The first-party providers.
    pub first_party_providers: Vec<FirstPartyProvider>,
    /// The Node server targets.
    pub server_targets: Vec<TargetCompatibility>,
    /// The Node client targets.
    pub client_targets: Vec<TargetCompatibility>,
    /// The JVM targets.
    pub jvm_targets: Vec<NativeTargetCompatibility>,
    /// The PHP targets.
    pub php_targets: Vec<NativeTargetCompatibility>,
    /// The Python targets, from `python-targets.json`.
    #[serde(skip)]
    pub python_targets: Vec<PythonTargetCompatibility>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PythonTargetsFile {
    python_targets: Vec<PythonTargetCompatibility>,
}

impl CompatibilityMatrix {
    /// Parses the compiled-in data and checks what the TypeScript checks at load: validator and
    /// client styles of their kind, PHP floors of a tested major.
    ///
    /// # Errors
    ///
    /// When a file does not parse or a record breaks a check.
    pub fn parse() -> Result<Self, CompatibilityError> {
        let mut matrix: Self =
            serde_json::from_str(MATRIX_JSON).map_err(|error| CompatibilityError::Malformed {
                file: "matrix.json",
                message: error.to_string(),
            })?;
        let python: PythonTargetsFile =
            serde_json::from_str(PYTHON_TARGETS_JSON).map_err(|error| {
                CompatibilityError::Malformed {
                    file: "python-targets.json",
                    message: error.to_string(),
                }
            })?;

        matrix.python_targets = python.python_targets;

        for target in matrix.server_targets.iter().chain(&matrix.client_targets) {
            check_styles(target)?;
        }

        for target in &matrix.php_targets {
            check_php_floor(target)?;
        }

        Ok(matrix)
    }

    /// The client target recorded for `package`.
    ///
    /// # Errors
    ///
    /// [`CompatibilityError::NotRecorded`] when none is.
    pub fn client_target(&self, package: &str) -> Result<&TargetCompatibility, CompatibilityError> {
        target_in(&self.client_targets, "client", package)
    }

    /// The server target recorded for `package`.
    ///
    /// # Errors
    ///
    /// [`CompatibilityError::NotRecorded`] when none is.
    pub fn server_target(&self, package: &str) -> Result<&TargetCompatibility, CompatibilityError> {
        target_in(&self.server_targets, "server", package)
    }

    /// The server and client targets, servers first.
    pub fn all_targets(&self) -> impl Iterator<Item = &TargetCompatibility> {
        self.server_targets.iter().chain(&self.client_targets)
    }

    /// The first-party packages writing `style`, in provider order.
    #[must_use]
    pub fn first_party_packages_of_style(&self, style: LinkStyle) -> Vec<&str> {
        self.first_party_providers
            .iter()
            .filter(|provider| provider.style == style)
            .map(|provider| provider.package.as_str())
            .collect()
    }

    /// Every framework major, consumer and validator the server targets offer together.
    #[must_use]
    pub fn offered_validator_pairs(&self) -> Vec<ValidatorPair> {
        let mut pairs = Vec::new();

        for target in &self.server_targets {
            let validators = self.validator_packages_of(target);

            for tested in &target.framework.tested {
                pairs.extend(validators.iter().map(|(id, package)| ValidatorPair {
                    target: target.package.clone(),
                    framework: target.framework.package.clone(),
                    framework_major: tested.major,
                    consumer: tested.consumer.clone(),
                    validator: (*id).to_owned(),
                    validator_package: (*package).to_owned(),
                }));
            }
        }

        pairs
    }

    /// The first-party validator providers whose style `target` reads.
    #[must_use]
    pub fn validator_providers_of(&self, target: &TargetCompatibility) -> Vec<&FirstPartyProvider> {
        self.first_party_providers
            .iter()
            .filter(|provider| {
                provider.kind == LinkKind::Validators
                    && target.validator_styles.contains(&provider.style)
            })
            .collect()
    }

    /// The validator ids and packages a server target is offered with: the providers, then its
    /// own validators under its own package.
    fn validator_packages_of<'matrix>(
        &'matrix self,
        target: &'matrix TargetCompatibility,
    ) -> Vec<(&'matrix str, &'matrix str)> {
        let providers = self
            .validator_providers_of(target)
            .into_iter()
            .map(|provider| (provider.id.as_str(), provider.package.as_str()));
        let own = target
            .own_validators
            .iter()
            .map(|validator| (validator.id.as_str(), target.package.as_str()));

        providers.chain(own).collect()
    }
}

/// The tested majors of a target's framework.
#[must_use]
pub fn supported_majors_of(target: &TargetCompatibility) -> Vec<u32> {
    target
        .framework
        .tested
        .iter()
        .map(|tested| tested.major)
        .collect()
}

fn target_in<'matrix>(
    targets: &'matrix [TargetCompatibility],
    role: &'static str,
    package: &str,
) -> Result<&'matrix TargetCompatibility, CompatibilityError> {
    targets
        .iter()
        .find(|target| target.package == package)
        .ok_or_else(|| {
            let recorded: Vec<&str> = targets
                .iter()
                .map(|target| target.package.as_str())
                .collect();

            CompatibilityError::NotRecorded {
                role,
                package: package.to_owned(),
                recorded: recorded.join(", "),
            }
        })
}

fn check_styles(target: &TargetCompatibility) -> Result<(), CompatibilityError> {
    let checks = [
        (
            &target.validator_styles,
            LinkKind::Validators,
            "validatorStyles",
        ),
        (&target.client_styles, LinkKind::Client, "clientStyles"),
    ];

    for (styles, kind, member) in checks {
        if let Some(style) = styles.iter().find(|style| style.kind() != kind) {
            return Err(CompatibilityError::Invalid {
                message: format!(
                    "{} {member} is '{}', not a {} style.",
                    target.package,
                    style.as_str(),
                    kind.as_str()
                ),
            });
        }
    }

    Ok(())
}

/// A PHP floor is `<major>.<minor>` of a tested major.
fn check_php_floor(target: &NativeTargetCompatibility) -> Result<(), CompatibilityError> {
    let Some(floor) = &target.framework.floor else {
        return Ok(());
    };
    let tested: Vec<u32> = target
        .framework
        .tested
        .iter()
        .map(|tested| tested.major)
        .collect();
    let floor_major = floor
        .split_once('.')
        .filter(|(major, minor)| is_digits(major) && is_digits(minor))
        .and_then(|(major, _)| major.parse::<u32>().ok());

    if floor_major.is_some_and(|major| tested.contains(&major)) {
        return Ok(());
    }

    let tested_text: Vec<String> = tested.iter().map(u32::to_string).collect();

    Err(CompatibilityError::Invalid {
        message: format!(
            "{} floor is '{floor}', not <major>.<minor> of a tested major ({}).",
            target.package,
            tested_text.join(", ")
        ),
    })
}

fn is_digits(text: &str) -> bool {
    !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_compiled_in_data_parses() {
        let matrix = CompatibilityMatrix::parse().unwrap();

        assert_eq!(
            matrix.python_targets.len(),
            3,
            "the Python targets are read beside the matrix"
        );
        assert_eq!(
            matrix.first_party_packages_of_style(LinkStyle::Fetch),
            ["@seampact/codegen-fetch", "@seampact/codegen-axios"]
        );
    }

    #[test]
    fn an_unrecorded_target_is_named_with_the_recorded_ones() {
        let matrix = CompatibilityMatrix::parse().unwrap();
        let refused = matrix.server_target("@seampact/codegen-none").unwrap_err();

        assert!(
            refused.to_string().contains("@seampact/codegen-hono"),
            "{refused}"
        );
    }
}
