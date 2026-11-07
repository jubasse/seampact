package io.github.jubasse.seampact.hooks;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

/**
 * A read-only view of the HTTP request, the same for every hook.
 *
 * @param method the HTTP method
 * @param path the request path
 * @param headers header names in lower case; a repeated header keeps every value in order
 * @param clientAddress the address the framework reports for the client, empty when it reports none
 */
public record RequestView(
        String method, String path, Map<String, List<String>> headers, Optional<String> clientAddress) {
    public RequestView {
        Objects.requireNonNull(method, "method");
        Objects.requireNonNull(path, "path");
        headers = copyHeaders(Objects.requireNonNull(headers, "headers"));
        Objects.requireNonNull(clientAddress, "clientAddress");
    }

    private static Map<String, List<String>> copyHeaders(Map<String, List<String>> headers) {
        Map<String, List<String>> copy = new LinkedHashMap<>();
        headers.forEach((name, values) -> copy.put(name, List.copyOf(values)));

        return Map.copyOf(copy);
    }

    /** Header values may carry credentials, so only the method, path and client address are shown. */
    @Override
    public String toString() {
        return "RequestView[method=" + method + ", path=" + path + ", headers=" + Redaction.REDACTED
                + ", clientAddress=" + clientAddress + "]";
    }
}
