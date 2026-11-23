//! The oracle's tool subject: each tool case run through the entry functions of the port, one
//! module per tool so each port lane fills its own.

mod bundle;
mod cli_case;
mod diff;
mod generator_registry;
mod json;
mod lint;
mod openapi;
mod recorded;
mod stub_answer;
mod tool_subject;

pub use tool_subject::CliToolSubject;
