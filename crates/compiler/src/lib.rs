//! The compiler of the Rust port: the stages in run order.
//!
//! Today it holds the oracle subject: with the `oracle` feature, [`oracle::CompilerSubject`]
//! implements the oracle's `OracleSubject` over the stages that are ported, which is the loader.
//! The shipped CLI is built without the feature and carries no harness.

#[cfg(feature = "oracle")]
pub mod oracle;
