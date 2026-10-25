package com.example.consumer;

import java.util.Optional;

/** The boot variant this process starts with (ADR 0015 "Boot tests"); unset, the app starts as configured. */
final class BootVariant {
    static final String ENVIRONMENT_VARIABLE = "SEAMPACT_SUITE_BOOT_VARIANT";

    private BootVariant() {}

    static Optional<String> current() {
        return Optional.ofNullable(System.getenv(ENVIRONMENT_VARIABLE)).filter(value -> !value.isEmpty());
    }

    static boolean is(String variant) {
        return current().filter(variant::equals).isPresent();
    }
}
