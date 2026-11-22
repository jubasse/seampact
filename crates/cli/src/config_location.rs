//! Where a command finds the app config and how it names it in messages.

use camino::{Utf8Path, Utf8PathBuf};
use seampact_cli_config::resolved_path;

/// The file name of an app config, read from the working directory when `--config` is absent.
pub(crate) const APP_CONFIG_FILE_NAME: &str = "seampact.config.yaml";

/// The app config file and the name problems show for it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ConfigLocation {
    pub(crate) file: Utf8PathBuf,
    pub(crate) display_name: String,
}

/// The app config named by `--config`, else the default file, resolved against `cwd`.
pub(crate) fn config_location(cwd: &Utf8Path, config_option: Option<&str>) -> ConfigLocation {
    let file = resolved_path(cwd, config_option.unwrap_or(APP_CONFIG_FILE_NAME));

    ConfigLocation {
        display_name: display_path(cwd, &file),
        file,
    }
}

/// `file` relative to `cwd` with `/` separators when it lies below `cwd`, else `file` as given.
pub(crate) fn display_path(cwd: &Utf8Path, file: &Utf8Path) -> String {
    let resolved_cwd = resolved_path(cwd, ".");
    let resolved_file = resolved_path(&resolved_cwd, file.as_str());

    match resolved_file.strip_prefix(&resolved_cwd) {
        Ok(inside) if !inside.as_str().is_empty() => {
            let segments: Vec<&str> = inside
                .components()
                .map(|component| component.as_str())
                .collect();

            segments.join("/")
        }
        Ok(_) | Err(_) => file.as_str().to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_path_below_the_directory_shows_relative_and_any_other_shows_whole() {
        let cwd = Utf8Path::new("/work/app");
        let cases = [
            ("/work/app/seampact.config.yaml", "seampact.config.yaml"),
            ("/work/app/a/b.yaml", "a/b.yaml"),
            ("/work/app", "/work/app"),
            ("/work/other/b.yaml", "/work/other/b.yaml"),
            ("/work/app2/b.yaml", "/work/app2/b.yaml"),
            ("/work/app/../x.yaml", "/work/app/../x.yaml"),
        ];

        for (file, expected) in cases {
            assert_eq!(display_path(cwd, Utf8Path::new(file)), expected, "{file}");
        }
    }
}
