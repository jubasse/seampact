//! The `seampact` binary: runs one command line with the process streams and exits with its code.

use std::ffi::OsString;
use std::process::ExitCode;

use anyhow::Context as _;
use camino::Utf8PathBuf;
use seampact_cli::{ProcessIo, run_cli};

fn main() -> anyhow::Result<ExitCode> {
    let argv: Vec<OsString> = std::env::args_os().skip(1).collect();
    let cwd = std::env::current_dir().context("cannot read the working directory")?;
    let cwd = Utf8PathBuf::try_from(cwd).context("the working directory is not UTF-8")?;
    let mut io = ProcessIo::new(cwd);
    let exit_code = run_cli(&argv, &mut io);
    let exit_code = u8::try_from(exit_code)
        .with_context(|| format!("exit code {exit_code} is out of range"))?;

    Ok(ExitCode::from(exit_code))
}
