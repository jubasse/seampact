//! The steps the loader's file store takes to resolve an authored path, over any reader.

use seampact_load::{
    CaseCheck, ListingIndexes, LoadReader, PathProblem, check_case, is_inside,
    resolve_authored_path,
};

/// What the file store decides about an authored path.
#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    Refused(PathProblem),
    Missing,
    Escaped,
    Case(String),
    Real(String),
}

/// Resolves `raw`, written in `from_file`, inside `boundary`: the lexical checks, the case check
/// below the boundary, then the real path, which must stay inside the boundary's real path.
pub fn resolve_in(reader: &dyn LoadReader, from_file: &str, raw: &str, boundary: &str) -> Outcome {
    let resolved = match resolve_authored_path(from_file, raw, boundary) {
        Ok(resolved) => resolved,
        Err(problem) => return Outcome::Refused(problem),
    };
    let Some(real_boundary) = reader.real_path(boundary) else {
        return Outcome::Missing;
    };
    let inside = |directory: &str| {
        reader
            .real_path(directory)
            .is_none_or(|real| is_inside(&real_boundary, &real))
    };
    let mut indexes = ListingIndexes::new();

    match check_case(reader, &mut indexes, &resolved.path, boundary, inside) {
        CaseCheck::Escape => return Outcome::Escaped,
        CaseCheck::Missing => return Outcome::Missing,
        CaseCheck::Case { actual } => return Outcome::Case(actual),
        CaseCheck::Ok => {}
    }

    match reader.real_path(&resolved.path) {
        None => Outcome::Missing,
        Some(real) if !is_inside(&real_boundary, &real) => Outcome::Escaped,
        Some(real) => Outcome::Real(real),
    }
}
