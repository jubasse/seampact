package com.example.tasksservice.api.schemas;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record CallerServiceParams(@Size(min = 1) @NotNull List<@NotNull Service> allowed) {
    @Override
    public String toString() {
        return "CallerServiceParams[allowed=" + this.allowed() + "]";
    }
}
