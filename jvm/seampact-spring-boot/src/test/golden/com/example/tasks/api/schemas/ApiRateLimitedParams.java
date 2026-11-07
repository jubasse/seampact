package com.example.tasks.api.schemas;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record ApiRateLimitedParams(@Min(0) @Max(9007199254740991L) long retryAfterMs) {
    @Override
    public String toString() {
        return "ApiRateLimitedParams[retryAfterMs=" + this.retryAfterMs() + "]";
    }
}
