package com.example.consumer;

import io.github.jubasse.seampact.hooks.Purpose;

/** The purpose of a decide call as the suite's script names it: `route`, `field` or `sortKey`. */
final class Purposes {
    private Purposes() {}

    static String nameOf(Purpose purpose) {
        return switch (purpose) {
            case Purpose.Route route -> "route";
            case Purpose.Field field -> "field";
            case Purpose.SortKey sortKey -> "sortKey";
        };
    }
}
