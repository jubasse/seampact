package com.example.tasks.api.schemas;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;

public record GetTasksBatchInput(@Size(max = 200) @NotNull List<@NotNull UUID> ids) {
    @Override
    public String toString() {
        return "GetTasksBatchInput[ids=" + ids() + "]";
    }
}
