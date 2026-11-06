package com.example.tasks.api.schemas;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record RolesParams(@Size(min = 1) @NotNull List<@NotNull Role> allowed) {
    @Override
    public String toString() {
        return "RolesParams[allowed=" + this.allowed() + "]";
    }
}
