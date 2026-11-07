"""Feeds every record the app logs to the control state, where `/__seampact/log-lines` reads it."""

import logging
from typing import Final

from seampact_consumer_suite.control_state import write_log_line

# Its own level, so the line is logged whatever level the app gives the root logger.
_TRACE_LOGGER: Final = logging.getLogger("consumer.trace")
_TRACE_LOGGER.setLevel(logging.INFO)


class SuiteLogHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        try:
            write_log_line(record.getMessage())
        except Exception:
            self.handleError(record)


def log_trace_context(trace_context: str | None) -> None:
    """The trace context reaches the handler as sent, never refused, so the handler can relay it on its own calls."""
    if trace_context is not None:
        _TRACE_LOGGER.info("trace context %s", trace_context)
