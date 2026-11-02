"""Feeds every record the app logs to the control state, where `/__seampact/log-lines` reads it."""

import logging

from seampact_consumer_suite.control_state import write_log_line


class SuiteLogHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        try:
            write_log_line(record.getMessage())
        except Exception:
            self.handleError(record)
