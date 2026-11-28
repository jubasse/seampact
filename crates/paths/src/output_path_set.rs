//! The output paths of one root, checked for names a file system would read as one.

use std::collections::{HashMap, HashSet};
use std::fmt;

use crate::case_folded::case_folded;
use crate::relative_output_path::RelativeOutputPath;

/// Why a path clashes with an earlier path of the same [`OutputPathSet`].
///
/// [`Display`](fmt::Display) words it as the generated-file writer does, after "and".
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum OutputPathClash {
    /// The same path came earlier.
    GeneratedTwice,
    /// An earlier file has the same name once folded.
    FileSpelling {
        /// The earlier file, as spelled.
        earlier_file: String,
    },
    /// An earlier path uses this file's name as a directory.
    FileOverDirectory {
        /// The earlier directory, as spelled.
        earlier_directory: String,
    },
    /// A directory of this path is an earlier file.
    DirectoryIsFile {
        /// The directory of this path.
        directory: String,
        /// The earlier file, as spelled.
        file: String,
    },
    /// A directory of this path is spelled otherwise by an earlier path.
    DirectorySpelling {
        /// The directory of this path.
        directory: String,
        /// The earlier path's directory, as spelled.
        earlier_directory: String,
    },
}

impl fmt::Display for OutputPathClash {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::GeneratedTwice => formatter.write_str("it is generated twice"),
            Self::FileSpelling { earlier_file } => {
                write!(
                    formatter,
                    "it differs only by letter case from '{earlier_file}'"
                )
            }
            Self::FileOverDirectory { earlier_directory } => write!(
                formatter,
                "it is a file, and an earlier path uses '{earlier_directory}' as a directory"
            ),
            Self::DirectoryIsFile { directory, file } => write!(
                formatter,
                "its directory '{directory}' is also the file '{file}'"
            ),
            Self::DirectorySpelling {
                directory,
                earlier_directory,
            } => write!(
                formatter,
                "its directory '{directory}' differs only by letter case from the directory '{earlier_directory}' of an earlier path"
            ),
        }
    }
}

/// The paths written below one root so far, by exact spelling and by [`case_folded`] key.
///
/// The first spelling of a folded name is the one later clashes name.
#[derive(Debug, Clone, Default)]
pub struct OutputPathSet {
    exact_paths: HashSet<String>,
    file_by_folded_path: HashMap<String, String>,
    directory_by_folded_path: HashMap<String, String>,
}

impl OutputPathSet {
    /// An empty set.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds the path and answers how it clashes with an earlier one, if it does.
    ///
    /// A clashing path is added too, as the TypeScript writer does, so every later path is checked
    /// against all the paths before it.
    #[must_use]
    pub fn insert(&mut self, path: &RelativeOutputPath) -> Option<OutputPathClash> {
        let clash = self.file_clash(path);

        self.remember(path);

        clash
    }

    fn file_clash(&self, path: &RelativeOutputPath) -> Option<OutputPathClash> {
        if self.exact_paths.contains(path.as_str()) {
            return Some(OutputPathClash::GeneratedTwice);
        }

        let folded_path = case_folded(path.as_str());

        if let Some(earlier_file) = self.file_by_folded_path.get(&folded_path) {
            return Some(OutputPathClash::FileSpelling {
                earlier_file: earlier_file.clone(),
            });
        }

        if let Some(earlier_directory) = self.directory_by_folded_path.get(&folded_path) {
            return Some(OutputPathClash::FileOverDirectory {
                earlier_directory: earlier_directory.clone(),
            });
        }

        self.directory_clash(path)
    }

    fn directory_clash(&self, path: &RelativeOutputPath) -> Option<OutputPathClash> {
        for directory in path.directories() {
            let folded_directory = case_folded(directory);

            if let Some(file) = self.file_by_folded_path.get(&folded_directory) {
                return Some(OutputPathClash::DirectoryIsFile {
                    directory: directory.to_owned(),
                    file: file.clone(),
                });
            }

            let earlier_directory = self.directory_by_folded_path.get(&folded_directory);

            if let Some(earlier_directory) =
                earlier_directory.filter(|earlier| *earlier != directory)
            {
                return Some(OutputPathClash::DirectorySpelling {
                    directory: directory.to_owned(),
                    earlier_directory: earlier_directory.clone(),
                });
            }
        }

        None
    }

    fn remember(&mut self, path: &RelativeOutputPath) {
        self.exact_paths.insert(path.as_str().to_owned());
        self.file_by_folded_path
            .entry(case_folded(path.as_str()))
            .or_insert_with(|| path.as_str().to_owned());

        for directory in path.directories() {
            self.directory_by_folded_path
                .entry(case_folded(directory))
                .or_insert_with(|| directory.to_owned());
        }
    }
}
