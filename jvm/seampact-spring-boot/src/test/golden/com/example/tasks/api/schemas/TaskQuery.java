package com.example.tasks.api.schemas;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Optional;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record TaskQuery(Optional<String> text,
        Optional<@Size(max = 3) List<@NotNull TaskState>> states) {
    @Override
    public String toString() {
        return "TaskQuery[text=" + this.text() + ", states=" + this.states() + "]";
    }
}
