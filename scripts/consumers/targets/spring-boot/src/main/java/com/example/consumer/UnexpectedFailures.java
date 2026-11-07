package com.example.consumer;

import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Logs an unexpected failure as an app's error reporter would; the log-lines route captures the line. */
final class UnexpectedFailures {
    private static final Logger LOG = LoggerFactory.getLogger("consumer");

    private UnexpectedFailures() {}

    static void log(String api, Optional<String> operation, String reason, Optional<Throwable> cause) {
        String why = cause.map(Throwable::getMessage).orElse(reason);
        LOG.error("unexpected failure in {}.{}: {}", api, operation.orElse("(none)"), why);
    }
}
