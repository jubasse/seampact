package com.example.optins.api.spring.runtime;

import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.time.temporal.ChronoField;
import tools.jackson.core.JsonGenerator;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.SerializationContext;
import tools.jackson.databind.ValueSerializer;
import tools.jackson.databind.cfg.DateTimeFeature;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.module.SimpleModule;

/**
 * The boundary's own Jackson 3 mapper, never the app's bean (ADR 0012 "Each target places the steps"): a date-time
 * keeps the offset it was sent with and is written with its seconds (RFC 3339), and a number never binds to a string.
 */
final class BoundaryMapper {
    private static final DateTimeFormatter RFC_3339 = new DateTimeFormatterBuilder()
            .append(DateTimeFormatter.ISO_LOCAL_DATE)
            .appendLiteral('T')
            .appendPattern("HH:mm:ss")
            .optionalStart()
            .appendFraction(ChronoField.NANO_OF_SECOND, 0, 9, true)
            .optionalEnd()
            .appendOffset("+HH:MM", "Z")
            .toFormatter();

    private BoundaryMapper() {}

    static JsonMapper create() {
        SimpleModule dateTimes = new SimpleModule("seampact-date-times");
        dateTimes.addSerializer(OffsetDateTime.class, new OffsetDateTimeWriter());

        return JsonMapper.builder()
                .disable(DateTimeFeature.ADJUST_DATES_TO_CONTEXT_TIME_ZONE)
                .disable(DateTimeFeature.WRITE_DATES_AS_TIMESTAMPS)
                .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                .addModule(dateTimes)
                .build();
    }

    private static final class OffsetDateTimeWriter extends ValueSerializer<OffsetDateTime> {
        @Override
        public void serialize(OffsetDateTime value, JsonGenerator generator, SerializationContext context) {
            generator.writeString(RFC_3339.format(value));
        }
    }
}
