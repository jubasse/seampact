package com.example.tasks.api.schemas;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.Min;
import java.util.Optional;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record ApiPayloadTooLargeParams(Optional<@Min(0) Long> limitBytes) {
    @Override
    public String toString() {
        return "ApiPayloadTooLargeParams[limitBytes=" + this.limitBytes() + "]";
    }
}
