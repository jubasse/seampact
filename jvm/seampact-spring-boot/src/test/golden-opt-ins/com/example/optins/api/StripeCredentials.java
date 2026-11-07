package com.example.optins.api;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record StripeCredentials() {
    @Override
    public String toString() {
        return "StripeCredentials[]";
    }
}
