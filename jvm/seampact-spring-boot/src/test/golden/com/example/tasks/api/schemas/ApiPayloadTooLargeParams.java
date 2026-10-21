package com.example.tasks.api.schemas;

import jakarta.validation.constraints.Min;
import java.util.Optional;

public record ApiPayloadTooLargeParams(Optional<@Min(0) Long> limitBytes) {
    @Override
    public String toString() {
        return "ApiPayloadTooLargeParams[limitBytes=" + limitBytes() + "]";
    }
}
