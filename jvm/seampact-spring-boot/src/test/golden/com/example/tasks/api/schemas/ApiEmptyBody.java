package com.example.tasks.api.schemas;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record ApiEmptyBody() {
    @Override
    public String toString() {
        return "ApiEmptyBody[]";
    }
}
