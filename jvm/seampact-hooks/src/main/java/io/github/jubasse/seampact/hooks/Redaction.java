package io.github.jubasse.seampact.hooks;

/** What {@code toString()} prints in place of a value that may carry a secret, so a logged object never leaks it. */
final class Redaction {
    static final String REDACTED = "[redacted]";

    private Redaction() {}
}
