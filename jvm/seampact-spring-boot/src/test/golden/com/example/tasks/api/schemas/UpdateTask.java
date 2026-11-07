package com.example.tasks.api.schemas;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.Min;
import java.util.Optional;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record UpdateTask(Optional<String> title, Optional<TaskState> state,
        Optional<@Min(0) Long> effort, @Min(1) long expectedVersion) {
    @Override
    public String toString() {
        return "UpdateTask[title=" + this.title() + ", state=" + this.state() + ", effort=" + this.effort() + ", expectedVersion=" + this.expectedVersion() + "]";
    }
}
