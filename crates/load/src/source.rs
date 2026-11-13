//! The file store of one load: reads each file once, checks every authored path against the
//! rules of ADR 0002 section 1, parses each file once and reports the YAML pitfalls P1 to P5, P9
//! and syntax errors on that first parse.
//!
//! The store owns the [`SourceFiles`] table: a file's text is added when it is first read, and
//! every span of the load points into it. The reporter is not the store's; each method that
//! reports takes it, as the expander and the loader share it.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use indexmap::IndexSet;
use seampact_diagnostics::InternalError;
use seampact_span::{FileId, SourceFile, SourceFiles, Span, TextSize};

use crate::scalars::{PitfallPatterns, ScalarPitfall, resolve_plain_scalar};
use crate::yaml::{YamlKind, YamlNode, YamlProblem, parse_yaml};
use crate::{
    CaseCheck, LOAD_MAX_DEPTH, LOAD_MAX_FILE_BYTES, ListingIndexes, LoadReader, LoadRule, LoadText,
    PathProblem, PendingDiagnostic, ROOT_BOUNDARY, Reporter, check_case, is_inside,
    resolve_authored_path, utf16_length,
};

const SHOWN_SOURCE_LIMIT: u64 = 40;
const SHOWN_SOURCE_KEPT: usize = 37;
const MERGE_KEY: &str = "<<";
const ELLIPSIS: &str = "...";
const LONE_SURROGATE_AS_WRITTEN: char = '\u{FFFD}';
const ANCHOR_FIX: &str = "use $ref to share a declaration, or extends to share a base";

/// A parsed file: its path, the boundary it must stay inside and its tree.
#[derive(Debug, Clone)]
pub struct ParsedFile {
    /// The root-relative path the file was asked for.
    pub path: String,
    /// The boundary every path written in the file must stay inside.
    pub boundary: String,
    /// The file in the load's [`SourceFiles`].
    pub file: FileId,
    /// `None` when the file failed to parse or holds no node.
    pub root: Option<YamlNode>,
}

impl ParsedFile {
    /// Where a path written in this file is resolved from.
    #[must_use]
    pub fn path_context(&self) -> PathContext<'_> {
        PathContext {
            path: &self.path,
            boundary: &self.boundary,
        }
    }
}

/// What a path is written in: how it reads in a message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileKind {
    /// `$include`.
    Include,
    /// `$ref`.
    Ref,
    /// `$file`.
    File,
    /// `extends`.
    Extends,
    /// `packs`.
    Pack,
    /// `workspace`.
    Workspace,
    /// `seampact.pack`.
    Manifest,
}

impl FileKind {
    /// The word a message uses for the place the path is written.
    #[must_use]
    pub fn what(self) -> &'static str {
        match self {
            Self::Include => "$include",
            Self::Ref => "$ref",
            Self::File => "$file",
            Self::Extends => "extends",
            Self::Pack => "packs",
            Self::Workspace => "workspace",
            Self::Manifest => "seampact.pack",
        }
    }
}

/// Where a path is written from: the containing file and the boundary it must stay inside.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PathContext<'file> {
    /// The root-relative path of the containing file.
    pub path: &'file str,
    /// The boundary the resolved path must stay inside.
    pub boundary: &'file str,
}

/// An authored path that passed every check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedFile {
    /// The lexical root-relative path.
    pub path: String,
    /// The checked real path (root-relative), the file's identity: cycles and reads use it.
    pub real: String,
    /// The text after the first `#`, when the site names part of the file.
    pub fragment: Option<String>,
}

/// What [`FileStore::check_file`] found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CheckedFile {
    /// The file exists inside its boundary: its real path.
    Real(String),
    /// A diagnostic was reported.
    Reported,
    /// The file is missing and nothing was reported ([`OnMissing::Return`]).
    Missing,
}

/// What [`FileStore::check_file`] does when the file does not exist.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OnMissing {
    /// Report `seampact/load/file-missing`.
    Report,
    /// Return [`CheckedFile::Missing`] without a report: the `node_modules` walk goes on upward.
    Return,
}

/// The span of a node, or the start of the file when there is none.
#[must_use]
pub fn node_span(file: &ParsedFile, node: Option<&YamlNode>) -> Span {
    match node {
        Some(node) => node.span,
        None => Span::new(file.file, TextSize::from(0), TextSize::from(0)),
    }
}

/// A pair: from the key's start to the value's end.
#[must_use]
pub fn pair_span(file: &ParsedFile, key: Option<&YamlNode>, value: Option<&YamlNode>) -> Span {
    let start = key
        .map(|node| node.span.range.start())
        .or_else(|| value.map(|node| node.span.range.start()))
        .unwrap_or_else(|| TextSize::from(0));
    let end = value
        .map(|node| node.span.range.end())
        .or_else(|| key.map(|node| node.span.range.end()))
        .unwrap_or(start);

    Span::new(file.file, start, end)
}

/// The real path of `file`, asked of the reader once per load: a path named by many targets
/// resolves through one answer.
fn memo_real_path(
    reader: &dyn LoadReader,
    memo: &RefCell<HashMap<String, Option<String>>>,
    file: &str,
) -> Option<String> {
    if let Some(known) = memo.borrow().get(file) {
        return known.clone();
    }

    let real = reader.real_path(file);

    memo.borrow_mut().insert(file.to_owned(), real.clone());

    real
}

/// The files of one load.
pub struct FileStore<'run> {
    reader: &'run dyn LoadReader,
    files: SourceFiles,
    parsed: HashMap<String, Option<Rc<ParsedFile>>>,
    texts: HashMap<String, Option<FileId>>,
    /// Files named by a diagnostic but never read, each as an empty entry of the table.
    unread: HashMap<String, FileId>,
    /// Lexical path to the real path `check_file` accepted for it.
    reals: HashMap<String, String>,
    /// Every file the load read or tried to read, for the watch primitive.
    touched: IndexSet<String>,
    resolved: HashMap<String, ResolvedFile>,
    too_deep: HashSet<FileId>,
    listings: ListingIndexes,
    real_paths: RefCell<HashMap<String, Option<String>>>,
    patterns: PitfallPatterns,
}

impl<'run> FileStore<'run> {
    /// A store over `reader`.
    ///
    /// # Errors
    ///
    /// [`InternalError`] when a pitfall pattern does not compile.
    pub fn new(reader: &'run dyn LoadReader) -> Result<Self, InternalError> {
        Ok(Self {
            reader,
            files: SourceFiles::new(),
            parsed: HashMap::new(),
            texts: HashMap::new(),
            unread: HashMap::new(),
            reals: HashMap::new(),
            touched: IndexSet::new(),
            resolved: HashMap::new(),
            too_deep: HashSet::new(),
            listings: ListingIndexes::new(),
            real_paths: RefCell::new(HashMap::new()),
            patterns: PitfallPatterns::new()?,
        })
    }

    /// The files read so far, the table every span points into.
    #[must_use]
    pub fn files(&self) -> &SourceFiles {
        &self.files
    }

    /// The table, when the load is over.
    #[must_use]
    pub fn into_files(self) -> SourceFiles {
        self.files
    }

    /// The expressions of P1 to P4, built when the store was.
    #[must_use]
    pub fn patterns(&self) -> &PitfallPatterns {
        &self.patterns
    }

    /// The normalised text of a file of the table.
    #[must_use]
    pub fn text_of(&self, file: FileId) -> Option<&str> {
        self.files.get(file).map(SourceFile::text)
    }

    /// Every file the load read or tried to read, in the order it asked.
    #[must_use]
    pub fn touched(&self) -> &IndexSet<String> {
        &self.touched
    }

    /// Records a file the load tried to read.
    pub fn touch(&mut self, file: &str) {
        self.touched.insert(file.to_owned());
    }

    /// The checked real path of a file, its identity for cycle detection; the path itself when
    /// [`check_file`](Self::check_file) accepted none.
    #[must_use]
    pub fn real_of<'file>(&'file self, file: &'file str) -> &'file str {
        self.reals.get(file).map_or(file, String::as_str)
    }

    /// An empty span at the start of `path`, for a diagnostic about a file that is not read (too
    /// large, or the entry outside the root): it prints `1:1`.
    ///
    /// # Errors
    ///
    /// [`InternalError`] when the table is full.
    pub fn unread_file_span(&mut self, path: &str) -> Result<Span, InternalError> {
        if let Some(known) = self.unread.get(path) {
            return Ok(Span::new(*known, TextSize::from(0), TextSize::from(0)));
        }

        let file = self.files.add(path, "")?;

        self.unread.insert(path.to_owned(), file);

        Ok(Span::new(file, TextSize::from(0), TextSize::from(0)))
    }

    fn report(
        &self,
        reporter: &mut Reporter,
        rule: LoadRule,
        message: String,
        fix: &str,
        at: Span,
    ) -> Result<(), InternalError> {
        reporter.report(
            &self.files,
            PendingDiagnostic::new(rule, message, fix.to_owned(), at),
        )
    }

    /// The text of a file, read once from its real path, not the lexical one (narrows a swap in
    /// between), and added to the table. `None` when the file is missing or too large; a file too
    /// large is reported.
    ///
    /// # Errors
    ///
    /// [`InternalError`] when a span is outside its file or the table is full.
    pub fn raw_text(
        &mut self,
        reporter: &mut Reporter,
        file: &str,
    ) -> Result<Option<FileId>, InternalError> {
        self.touched.insert(file.to_owned());

        if let Some(known) = self.texts.get(file) {
            return Ok(*known);
        }

        let target = self.real_of(file).to_owned();
        let loaded = match self.reader.read_text(&target, LOAD_MAX_FILE_BYTES) {
            Some(LoadText::Text(text)) => Some(self.files.add(file, &text)?),
            Some(LoadText::TooLarge) => {
                self.report_file_too_large(reporter, file)?;

                None
            }
            None => None,
        };

        self.texts.insert(file.to_owned(), loaded);

        Ok(loaded)
    }

    fn report_file_too_large(
        &mut self,
        reporter: &mut Reporter,
        file: &str,
    ) -> Result<(), InternalError> {
        let at = self.unread_file_span(file)?;

        self.report(
            reporter,
            LoadRule::FileTooLarge,
            format!(
                "file '{file}' is larger than {LOAD_MAX_FILE_BYTES} bytes, the most one contract file may hold"
            ),
            "split the file, with $include, or shrink it",
            at,
        )
    }

    /// Resolves a path written in a contract file and checks every ADR 0002 section 1 rule: no
    /// absolute path, no backslash, inside the boundary (also after symlinks), case matching the
    /// disk, existing. Reports and returns `None` on failure; nothing outside the boundary is
    /// read.
    ///
    /// # Errors
    ///
    /// [`InternalError`] when a span is outside its file.
    pub fn resolve(
        &mut self,
        reporter: &mut Reporter,
        from: PathContext<'_>,
        raw: &str,
        at: Span,
        kind: FileKind,
    ) -> Result<Option<ResolvedFile>, InternalError> {
        // A path that resolved once resolves the same way: the checks list directories, and a
        // file included from many sites would repeat them.
        let cache_key = format!("{}\0{}\0{raw}", from.boundary, from.path);

        if let Some(hit) = self.resolved.get(&cache_key) {
            return Ok(Some(hit.clone()));
        }

        let what = kind.what();
        let resolved = match resolve_authored_path(from.path, raw, from.boundary) {
            Ok(resolved) => resolved,
            Err(problem) => {
                self.report_path_problem(reporter, problem, from, raw, what, at)?;

                return Ok(None);
            }
        };
        let CheckedFile::Real(real) = self.check_file(
            reporter,
            &resolved.path,
            from.boundary,
            at,
            what,
            raw,
            OnMissing::Report,
        )?
        else {
            return Ok(None);
        };
        let ok = ResolvedFile {
            path: resolved.path,
            real,
            fragment: resolved.fragment,
        };

        self.resolved.insert(cache_key, ok.clone());

        Ok(Some(ok))
    }

    fn report_path_problem(
        &self,
        reporter: &mut Reporter,
        problem: PathProblem,
        from: PathContext<'_>,
        raw: &str,
        what: &str,
        at: Span,
    ) -> Result<(), InternalError> {
        let (rule, message, fix) = match problem {
            PathProblem::Empty => (
                LoadRule::PathEmpty,
                format!("{what} names no file"),
                "write a path such as ./file.yaml",
            ),
            PathProblem::Backslash => (
                LoadRule::PathBackslash,
                format!("path '{raw}' of {what} uses a backslash"),
                "write the path with forward slashes",
            ),
            PathProblem::Absolute => (
                LoadRule::PathAbsolute,
                format!("path '{raw}' of {what} is absolute"),
                "write a path relative to this file, starting with ./ or ../",
            ),
            PathProblem::Escape => {
                let boundary = from.boundary;
                let place = if boundary == ROOT_BOUNDARY {
                    "the workspace root".to_owned()
                } else {
                    format!("the pack's package ({boundary})")
                };

                (
                    LoadRule::PathEscape,
                    format!("path '{raw}' of {what} leaves {place}"),
                    "move the file inside the workspace, or add a workspace.yaml at or above every file the contract reads",
                )
            }
        };

        self.report(reporter, rule, message, fix, at)
    }

    /// Existence, case and symlink checks for a path already inside its boundary (lexically).
    /// Containment comes first: every directory is checked inside the boundary, after links,
    /// before it is listed, and the file's real path after. An escape never names the outside
    /// target. With [`OnMissing::Return`] a missing file is not an error.
    ///
    /// # Errors
    ///
    /// [`InternalError`] when a span is outside its file.
    #[expect(
        clippy::too_many_arguments,
        reason = "the six inputs of checkFile, each a different thing; a struct would only rename them"
    )]
    pub fn check_file(
        &mut self,
        reporter: &mut Reporter,
        file: &str,
        boundary: &str,
        at: Span,
        what: &str,
        raw: &str,
        on_missing: OnMissing,
    ) -> Result<CheckedFile, InternalError> {
        let real_boundary = if boundary == ROOT_BOUNDARY {
            Some(ROOT_BOUNDARY.to_owned())
        } else {
            memo_real_path(self.reader, &self.real_paths, boundary)
        };
        let Some(real_boundary) = real_boundary else {
            return self.missing(reporter, file, what, at, on_missing);
        };
        let reader = self.reader;
        let real_paths = &self.real_paths;
        let inside = |path: &str| {
            memo_real_path(reader, real_paths, path)
                .is_none_or(|real| is_inside(&real_boundary, &real))
        };

        match check_case(reader, &mut self.listings, file, boundary, inside) {
            CaseCheck::Escape => return self.escaped(reporter, file, boundary, what, at),
            CaseCheck::Missing => return self.missing(reporter, file, what, at, on_missing),
            CaseCheck::Case { actual } => {
                self.touched.insert(file.to_owned());
                self.report(
                    reporter,
                    LoadRule::PathCase,
                    format!(
                        "path '{raw}' of {what} differs in case from the file on disk, '{actual}'"
                    ),
                    &format!(
                        "write the path as '{actual}'; compilation must not depend on the file system's case rules"
                    ),
                    at,
                )?;

                return Ok(CheckedFile::Reported);
            }
            CaseCheck::Ok => {}
        }

        let Some(real) = memo_real_path(self.reader, &self.real_paths, file) else {
            return self.missing(reporter, file, what, at, on_missing);
        };

        if !is_inside(&real_boundary, &real) {
            return self.escaped(reporter, file, boundary, what, at);
        }

        self.touched.insert(file.to_owned());
        self.reals.insert(file.to_owned(), real.clone());

        Ok(CheckedFile::Real(real))
    }

    fn missing(
        &mut self,
        reporter: &mut Reporter,
        file: &str,
        what: &str,
        at: Span,
        on_missing: OnMissing,
    ) -> Result<CheckedFile, InternalError> {
        self.touched.insert(file.to_owned());

        if on_missing == OnMissing::Return {
            return Ok(CheckedFile::Missing);
        }

        self.report(
            reporter,
            LoadRule::FileMissing,
            format!("file '{file}' named by {what} does not exist"),
            "create the file, or fix the path",
            at,
        )?;

        Ok(CheckedFile::Reported)
    }

    fn escaped(
        &self,
        reporter: &mut Reporter,
        file: &str,
        boundary: &str,
        what: &str,
        at: Span,
    ) -> Result<CheckedFile, InternalError> {
        let place = if boundary == ROOT_BOUNDARY {
            "the workspace root".to_owned()
        } else {
            format!("the package ({boundary})")
        };

        self.report(
            reporter,
            LoadRule::PathEscape,
            format!(
                "file '{file}' of {what} resolves through a symbolic link to a place outside {place}"
            ),
            "replace the link with a copy of the file, or move the target inside the workspace",
            at,
        )?;

        Ok(CheckedFile::Reported)
    }

    /// Parses a file once; pitfalls P1 to P5 and P9 and syntax errors are reported on first parse.
    ///
    /// # Errors
    ///
    /// [`InternalError`] when a span is outside its file.
    pub fn parse(
        &mut self,
        reporter: &mut Reporter,
        file: &str,
        boundary: &str,
    ) -> Result<Option<Rc<ParsedFile>>, InternalError> {
        let key = format!("{boundary}|{file}");

        if let Some(known) = self.parsed.get(&key) {
            return Ok(known.clone());
        }

        let Some(file_id) = self.raw_text(reporter, file)? else {
            self.parsed.insert(key, None);

            return Ok(None);
        };
        let Some(text) = self.text_of(file_id) else {
            return Err(InternalError::new(format!(
                "file '{file}' is in the table with no text"
            )));
        };
        let document = parse_yaml(file_id, text)?;

        self.report_problem(reporter, document.problem.as_ref())?;

        let parsed = Rc::new(ParsedFile {
            path: file.to_owned(),
            boundary: boundary.to_owned(),
            file: file_id,
            root: document.root,
        });

        self.parsed.insert(key, Some(Rc::clone(&parsed)));

        if let Some(root) = &parsed.root {
            self.walk(reporter, root, false, 0)?;
        }

        Ok(Some(parsed))
    }

    fn report_problem(
        &mut self,
        reporter: &mut Reporter,
        problem: Option<&YamlProblem>,
    ) -> Result<(), InternalError> {
        match problem {
            None => Ok(()),
            Some(YamlProblem::Syntax { info, at }) => self.report(
                reporter,
                LoadRule::YamlSyntax,
                format!("YAML syntax error: {info}"),
                "fix the YAML syntax at this position",
                *at,
            ),
            Some(YamlProblem::TooDeep { at }) => self.report_too_deep(reporter, *at),
            Some(YamlProblem::SecondDocument { at }) => self.report(
                reporter,
                LoadRule::YamlDocument,
                "the file holds more than one YAML document".to_owned(),
                "one document per file; remove the extra '---'",
                *at,
            ),
        }
    }

    fn walk(
        &mut self,
        reporter: &mut Reporter,
        node: &YamlNode,
        is_key: bool,
        depth: usize,
    ) -> Result<(), InternalError> {
        let at = node.span;

        if depth > LOAD_MAX_DEPTH {
            return self.report_too_deep(reporter, at);
        }

        if let YamlKind::Alias(name) = &node.kind {
            return self.report(
                reporter,
                LoadRule::YamlAnchor,
                format!("alias '*{}' is not allowed (P5)", name.as_str()),
                ANCHOR_FIX,
                at,
            );
        }

        if let Some(anchor) = &node.anchor {
            self.report(
                reporter,
                LoadRule::YamlAnchor,
                format!("anchor '&{}' is not allowed (P5)", anchor.as_str()),
                ANCHOR_FIX,
                at,
            )?;
        }

        if let Some(tag) = node.shown_tag() {
            self.report(
                reporter,
                LoadRule::YamlTag,
                format!("tag '{tag}' is not allowed (P9)"),
                "remove the tag; no tags are read, quote the value if it is a string",
                at,
            )?;
        } else if node.is_plain_scalar() {
            self.check_plain(reporter, node, is_key)?;
        }

        match &node.kind {
            YamlKind::Mapping(pairs) => {
                for pair in pairs {
                    self.walk(reporter, &pair.key, true, depth + 1)?;

                    if let Some(value) = &pair.value {
                        self.walk(reporter, value, false, depth + 1)?;
                    }
                }
            }
            YamlKind::Sequence(items) => {
                for item in items {
                    self.walk(reporter, item, false, depth + 1)?;
                }
            }
            YamlKind::Scalar { .. } | YamlKind::Alias(_) => {}
        }

        Ok(())
    }

    /// One report per file: every node below the limit would otherwise repeat it.
    ///
    /// # Errors
    ///
    /// [`InternalError`] when the span is outside its file.
    pub fn report_too_deep(
        &mut self,
        reporter: &mut Reporter,
        at: Span,
    ) -> Result<(), InternalError> {
        if !self.too_deep.insert(at.file) {
            return Ok(());
        }

        self.report(
            reporter,
            LoadRule::TooDeep,
            format!(
                "the contract nests deeper than {LOAD_MAX_DEPTH} levels here, counted through $include and $file"
            ),
            "flatten the nesting; a contract never needs this depth",
            at,
        )
    }

    fn check_plain(
        &self,
        reporter: &mut Reporter,
        node: &YamlNode,
        is_key: bool,
    ) -> Result<(), InternalError> {
        let source = node.scalar_text().unwrap_or("");
        let at = node.span;

        if source.is_empty() {
            return Ok(());
        }

        if is_key && source == MERGE_KEY {
            return self.report(
                reporter,
                LoadRule::YamlAnchor,
                "merge key '<<' is not allowed (P5)".to_owned(),
                ANCHOR_FIX,
                at,
            );
        }

        let resolved = resolve_plain_scalar(source);
        let Some(pitfall) = self.patterns.load_scalar_pitfall(source, &resolved) else {
            return Ok(());
        };
        let shown = shown_source(source);

        let (rule, message, fix) = match pitfall {
            ScalarPitfall::P1 => (
                LoadRule::YamlBoolean,
                format!(
                    "plain '{shown}' is read as a boolean by YAML 1.1 parsers, or is a boolean not in lowercase (P1)"
                ),
                format!("quote it ('{shown}'), or write true or false"),
            ),
            ScalarPitfall::P2 => (
                LoadRule::YamlNumberFormat,
                format!("plain number '{shown}' is not written in plain decimal (P2)"),
                "quote it, or write the number in plain decimal".to_owned(),
            ),
            ScalarPitfall::P3 => (
                LoadRule::YamlAmbiguousScalar,
                format!(
                    "plain '{shown}' is a number or a timestamp for YAML 1.1 and a string for YAML 1.2 (P3)"
                ),
                format!("quote it ('{shown}')"),
            ),
            ScalarPitfall::P4 => (
                LoadRule::YamlReservedScalar,
                format!("plain '{shown}' is a YAML 1.1 value or merge key (P4)"),
                format!("quote it ('{shown}')"),
            ),
        };

        self.report(reporter, rule, message, &fix, at)
    }
}

/// A scalar as a message shows it: the first 37 UTF-16 units and `...` past 40.
///
/// `source.slice(0, 37)` can cut a surrogate pair in two; the lone half has no Rust form and is
/// written as U+FFFD, which is what a JavaScript string with a lone surrogate becomes when it is
/// written as UTF-8.
fn shown_source(source: &str) -> String {
    if utf16_length(source) <= SHOWN_SOURCE_LIMIT {
        return source.to_owned();
    }

    let mut shown = String::new();
    let mut units = 0;

    for character in source.chars() {
        let width = character.len_utf16();

        if units + width > SHOWN_SOURCE_KEPT {
            if units < SHOWN_SOURCE_KEPT {
                shown.push(LONE_SURROGATE_AS_WRITTEN);
            }

            break;
        }

        shown.push(character);
        units += width;
    }

    shown.push_str(ELLIPSIS);

    shown
}

#[cfg(test)]
mod tests;
