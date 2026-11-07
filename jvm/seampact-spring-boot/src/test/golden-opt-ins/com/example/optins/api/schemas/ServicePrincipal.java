package com.example.optins.api.schemas;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record ServicePrincipal(@NotNull Service service, @NotNull UUID userId) {
    @Override
    public String toString() {
        return "ServicePrincipal[service=" + this.service() + ", userId=" + this.userId() + "]";
    }
}
