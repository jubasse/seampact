//! A problem of one app of a root run, located in front of its own location.

use seampact_cli_config::CliProblem;

/// `problem` located inside `app`, in front of its own location.
#[must_use]
pub fn in_app(app: &str, problem: CliProblem) -> CliProblem {
    let location = match &problem.location {
        Some(location) => format!("app '{app}', {location}"),
        None => format!("app '{app}'"),
    };

    CliProblem {
        location: Some(location),
        ..problem
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn problem_at(location: Option<&str>) -> CliProblem {
        CliProblem {
            code: "x.y".to_owned(),
            message: "m".to_owned(),
            fix: "f".to_owned(),
            location: location.map(str::to_owned),
            position: None,
            docs: None,
        }
    }

    #[test]
    fn a_problem_in_an_app_keeps_its_own_location_after_the_app() {
        assert_eq!(
            in_app("web", problem_at(None)).location.as_deref(),
            Some("app 'web'")
        );
        assert_eq!(
            in_app("web", problem_at(Some("entry 'e'")))
                .location
                .as_deref(),
            Some("app 'web', entry 'e'")
        );
    }
}
