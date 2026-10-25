package com.example.optins.api.spring.runtime;

import io.github.jubasse.seampact.hooks.ErrorCodeWithParams;
import java.util.Objects;
import java.util.Optional;

/**
 * What a hook denies with: one of the error codes its requirement, scope or identity declares, and the code's params
 * when it has some. The boundary answers a code the operation does not declare with the api's 500.
 */
public record Denial(String code, Optional<Object> params) implements ErrorCodeWithParams {
    public Denial {
        Objects.requireNonNull(code, "code");
        Objects.requireNonNull(params, "params");
    }

    public static Denial of(String code) {
        return new Denial(code, Optional.empty());
    }

    public static Denial of(String code, Object params) {
        return new Denial(code, Optional.of(params));
    }
}
