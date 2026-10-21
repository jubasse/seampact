package com.example.tasksservice.api.schemas;

import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public record ServicePrincipal(@NotNull Service service, @NotNull UUID userId) {
    @Override
    public String toString() {
        return "ServicePrincipal[service=" + service() + ", userId=" + userId() + "]";
    }
}
