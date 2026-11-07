package com.example.consumer;

import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.AppenderBase;

/** The Logback appender that feeds `GET /__seampact/log-lines` with every line the app and the boundary log. */
public final class LogLinesAppender extends AppenderBase<ILoggingEvent> {
    @Override
    protected void append(ILoggingEvent event) {
        SuiteControl.writeLogLine(event.getFormattedMessage());
    }
}
