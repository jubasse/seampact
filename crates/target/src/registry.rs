//! The generators of a build and the lookup of a `use` string.

use crate::{Generator, TargetId};

/// A first-party short id and its 1.x `use` strings, whether or not this build has its generator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct FirstPartyTarget {
    /// The short id.
    pub id: TargetId,
    /// The 1.x `use` strings.
    pub legacy_names: &'static [&'static str],
}

const fn first_party(id: &'static str, legacy_names: &'static [&'static str]) -> FirstPartyTarget {
    FirstPartyTarget {
        id: TargetId::new(id),
        legacy_names,
    }
}

/// Every first-party target of ADR 0031 "Target ids": the 16 TypeScript targets, then the PHP,
/// JVM and Python generators; a short id with no generator yet answers `config.target.not-built`.
pub const FIRST_PARTY_TARGETS: &[FirstPartyTarget] = &[
    first_party("adonis", &["@seampact/codegen-adonis"]),
    first_party("angular", &["@seampact/codegen-angular"]),
    first_party("axios", &["@seampact/codegen-axios"]),
    first_party("class-validator", &["@seampact/codegen-class-validator"]),
    first_party("express", &["@seampact/codegen-express"]),
    first_party("fastify", &["@seampact/codegen-fastify"]),
    first_party("fetch", &["@seampact/codegen-fetch"]),
    first_party("hono", &["@seampact/codegen-hono"]),
    first_party("msw", &["@seampact/codegen-msw"]),
    first_party("nestjs", &["@seampact/codegen-nestjs"]),
    first_party("nextjs", &["@seampact/codegen-nextjs"]),
    first_party("react", &["@seampact/codegen-react"]),
    first_party("ts", &["@seampact/codegen-ts"]),
    first_party("vue", &["@seampact/codegen-vue"]),
    first_party("yup", &["@seampact/codegen-yup"]),
    first_party("zod", &["@seampact/codegen-zod"]),
    first_party("laravel", &["seampact/laravel"]),
    first_party("symfony", &["seampact/symfony"]),
    first_party("api-platform", &["seampact/api-platform"]),
    first_party("spring-boot", &["io.github.jubasse:seampact-spring-boot"]),
    first_party("fastapi", &["pypi:seampact-fastapi"]),
    first_party("drf", &["pypi:seampact-drf"]),
    first_party("ninja", &["pypi:seampact-ninja"]),
];

/// The `use` string of an entry run by the external generator protocol.
pub const EXEC_USE: &str = "exec";

/// Why a `use` string names no generator of this build.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TargetLookupCode {
    /// `config.target.renamed`: a 1.x first-party string.
    Renamed,
    /// `config.target.external`: any other package string.
    External,
    /// `config.target.not-built`: a first-party short id whose family is not ported yet.
    NotBuilt,
    /// `config.target.exec-not-available`: `use: exec` before the protocol ships.
    ExecNotAvailable,
}

impl TargetLookupCode {
    /// Every code, as the unified refusal list names them.
    pub const ALL: [Self; 4] = [
        Self::Renamed,
        Self::External,
        Self::NotBuilt,
        Self::ExecNotAvailable,
    ];

    /// The code.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Renamed => "config.target.renamed",
            Self::External => "config.target.external",
            Self::NotBuilt => "config.target.not-built",
            Self::ExecNotAvailable => "config.target.exec-not-available",
        }
    }
}

/// A `use` string the registry refuses, with its code, message and fix; the caller adds where.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct TargetLookupProblem {
    /// The code.
    pub code: TargetLookupCode,
    /// What is refused.
    pub message: String,
    /// What to change.
    pub fix: String,
}

/// The generators of a build, scanned by short id; nothing runs before a lookup.
#[derive(Clone, Default)]
pub struct Registry {
    generators: Vec<&'static dyn Generator>,
}

impl std::fmt::Debug for Registry {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Registry")
            .field("generators", &self.generators)
            .finish()
    }
}

impl Registry {
    /// The registry of `generators`.
    #[must_use]
    pub fn new(generators: Vec<&'static dyn Generator>) -> Self {
        Self { generators }
    }

    /// This registry extended with `generators`, as the oracle adds the probes.
    #[must_use]
    pub fn with(mut self, generators: &[&'static dyn Generator]) -> Self {
        self.generators.extend_from_slice(generators);
        self
    }

    /// The generators, in registration order.
    pub fn generators(&self) -> impl Iterator<Item = &'static dyn Generator> + '_ {
        self.generators.iter().copied()
    }

    /// The generator `use_name` names.
    ///
    /// # Errors
    ///
    /// The [`TargetLookupProblem`] of a `use` string this build has no generator for.
    pub fn lookup(&self, use_name: &str) -> Result<&'static dyn Generator, TargetLookupProblem> {
        if let Some(generator) = self
            .generators
            .iter()
            .find(|generator| generator.metadata().id.as_str() == use_name)
        {
            return Ok(*generator);
        }

        Err(lookup_problem(use_name))
    }
}

fn lookup_problem(use_name: &str) -> TargetLookupProblem {
    if use_name == EXEC_USE {
        return TargetLookupProblem {
            code: TargetLookupCode::ExecNotAvailable,
            message: "The `exec` protocol is not in this build of seampact yet.".to_owned(),
            fix: "Use the 1.x CLI for this entry until the external generator protocol ships."
                .to_owned(),
        };
    }

    if let Some(target) = FIRST_PARTY_TARGETS
        .iter()
        .find(|target| target.id.as_str() == use_name)
    {
        return TargetLookupProblem {
            code: TargetLookupCode::NotBuilt,
            message: format!(
                "The target '{}' is not in this build of seampact yet.",
                target.id
            ),
            fix: "Use the 1.x CLI for this target until its family is ported.".to_owned(),
        };
    }

    if let Some(target) = FIRST_PARTY_TARGETS
        .iter()
        .find(|target| target.legacy_names.contains(&use_name))
    {
        return TargetLookupProblem {
            code: TargetLookupCode::Renamed,
            message: format!(
                "'{use_name}' is the 1.x name of the target '{}'.",
                target.id
            ),
            fix: format!("Write `use: {}`.", target.id),
        };
    }

    TargetLookupProblem {
        code: TargetLookupCode::External,
        message: format!("'{use_name}' is not a target of this build of seampact."),
        fix: "Run it as an external generator: an entry with `use: exec` and its `command`."
            .to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_each_refused_use_string_by_its_code() {
        let registry = Registry::default();
        let cases = [
            ("hono", TargetLookupCode::NotBuilt),
            ("@seampact/codegen-hono", TargetLookupCode::Renamed),
            ("pypi:seampact-fastapi", TargetLookupCode::Renamed),
            ("probe-server", TargetLookupCode::External),
            ("exec", TargetLookupCode::ExecNotAvailable),
        ];

        for (use_name, code) in cases {
            let problem = registry.lookup(use_name).err().map(|problem| problem.code);

            assert_eq!(problem, Some(code), "use {use_name}");
        }
    }

    #[test]
    fn every_first_party_id_is_the_package_name_without_its_prefix() {
        for target in FIRST_PARTY_TARGETS {
            let id = target.id.as_str();
            let derived = target.legacy_names.iter().any(|name| {
                let unscoped = name.rsplit(['/', ':']).next().unwrap_or(name);

                unscoped
                    .trim_start_matches("codegen-")
                    .trim_start_matches("seampact-")
                    == id
            });

            assert!(derived, "short id {id} of {:?}", target.legacy_names);
        }
    }
}
