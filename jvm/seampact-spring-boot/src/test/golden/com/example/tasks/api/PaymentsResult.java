package com.example.tasks.api;

import com.fasterxml.jackson.annotation.JsonInclude;

public sealed interface PaymentsResult permits PaymentsResult.Status204, PaymentsErrors {
    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record Status204() implements PaymentsResult {
        @Override
        public String toString() {
            return "Status204[]";
        }
    }
}
