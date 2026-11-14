//! The per-fixture time limit of a run: a fixture past it is a failure that names it, even when
//! the subject never returns.

use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crate::OracleError;

/// What runs on the watching thread when a fixture passes the limit while the subject is still
/// working on it, given the fixture path and the limit. A subject that never returns can only be
/// stopped from there; a run that does return reports the overrun in its verdict either way.
pub type TimeLimitAction = fn(fixture: &str, limit: Duration);

/// The fixture being compared and when it stops being on time.
struct Watched {
    fixture: String,
    deadline: Instant,
}

#[derive(Default)]
struct State {
    watched: Option<Watched>,
    finished: bool,
}

struct Shared {
    state: Mutex<State>,
    changed: Condvar,
}

impl Shared {
    // The state is plain data no panic can leave half written, so a poisoned lock is still usable.
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// The watcher of a run: one thread that fires the action when the fixture in flight passes the
/// limit; no thread when the run has no limit.
pub(crate) struct FixtureTimer {
    limit: Option<Duration>,
    shared: Arc<Shared>,
    thread: Option<JoinHandle<()>>,
}

/// A fixture that took longer than the limit.
pub(crate) struct Overrun {
    pub(crate) elapsed: Duration,
    pub(crate) limit: Duration,
}

impl FixtureTimer {
    /// Starts watching, with `action` fired once per overrunning fixture.
    ///
    /// # Errors
    ///
    /// When the watching thread cannot be started.
    pub(crate) fn start(
        limit: Option<Duration>,
        action: Option<TimeLimitAction>,
    ) -> Result<Self, OracleError> {
        let shared = Arc::new(Shared {
            state: Mutex::new(State::default()),
            changed: Condvar::new(),
        });

        let Some(limit) = limit else {
            return Ok(Self {
                limit: None,
                shared,
                thread: None,
            });
        };

        let watcher = Arc::clone(&shared);
        let thread = thread::Builder::new()
            .name("oracle-time-limit".to_owned())
            .spawn(move || watch(&watcher, limit, action))
            .map_err(|source| OracleError::Thread { source })?;

        Ok(Self {
            limit: Some(limit),
            shared,
            thread: Some(thread),
        })
    }

    /// Starts the clock of `fixture`.
    pub(crate) fn begin(&self, fixture: &str) -> Instant {
        let started = Instant::now();

        if let Some(limit) = self.limit {
            self.shared.lock().watched = Some(Watched {
                fixture: fixture.to_owned(),
                deadline: started + limit,
            });
            self.shared.changed.notify_all();
        }

        started
    }

    /// Stops the clock of the fixture begun at `started`, and says how far past the limit it ran.
    pub(crate) fn end(&self, started: Instant) -> Option<Overrun> {
        let limit = self.limit?;

        self.shared.lock().watched = None;
        self.shared.changed.notify_all();

        let elapsed = started.elapsed();

        (elapsed > limit).then_some(Overrun { elapsed, limit })
    }
}

impl Drop for FixtureTimer {
    fn drop(&mut self) {
        self.shared.lock().finished = true;
        self.shared.changed.notify_all();

        if let Some(thread) = self.thread.take() {
            // The watcher holds no failure to report: it only fires the action.
            let _ = thread.join();
        }
    }
}

fn watch(shared: &Shared, limit: Duration, action: Option<TimeLimitAction>) {
    let mut state = shared.lock();

    while !state.finished {
        let Some(watched) = &state.watched else {
            state = shared
                .changed
                .wait(state)
                .unwrap_or_else(PoisonError::into_inner);

            continue;
        };

        let remaining = watched.deadline.saturating_duration_since(Instant::now());

        if remaining.is_zero() {
            if let Some(action) = action {
                action(&watched.fixture, limit);
            }

            state.watched = None;

            continue;
        }

        state = shared
            .changed
            .wait_timeout(state, remaining)
            .unwrap_or_else(PoisonError::into_inner)
            .0;
    }
}
