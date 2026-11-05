package com.example.tasks.api.schemas;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record RecentAuthParams(@NotNull ReauthIntent intent) {
    @Override
    public String toString() {
        return "RecentAuthParams[intent=" + this.intent() + "]";
    }
}
