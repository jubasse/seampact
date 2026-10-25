package com.example.tasksservice.api.spring.runtime;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * A template scheme's signature header parsed by its format (ADR 0013 "Test vectors"), as the Node targets parse it:
 * comma-separated `name=value` pairs (`t={ts},v1={sig}`), each slot read from its pair and a repeated signature pair
 * adding a candidate, or a literal prefix before `{sig}` (`sha256={sig}`).
 */
record SignatureHeader(Optional<String> timestamp, List<String> candidateSignatures) {
    private static final String TIMESTAMP_SLOT = "{ts}";
    private static final String SIGNATURE_SLOT = "{sig}";
    private static final Pattern DIGITS = Pattern.compile("^[0-9]+$");
    private static final Pattern PAIR_FORMAT = Pattern.compile("^[A-Za-z0-9_-]+=\\{(ts|sig)\\}(,[A-Za-z0-9_-]+=\\{(ts|sig)\\})*$");

    /**
     * Empty for a missing or malformed header: no signature, a timestamp that is not digits, a repeated timestamp, or
     * a pair that is not `name=value`.
     */
    static Optional<SignatureHeader> parse(String format, String header) {
        if (header == null || header.isBlank()) return Optional.empty();
        if (!PAIR_FORMAT.matcher(format).matches()) return prefixed(format, header);

        String timestampName = null;
        String signatureName = null;
        for (String pair : format.split(",")) {
            String[] parts = pair.split("=", 2);
            if (TIMESTAMP_SLOT.equals(parts[1])) timestampName = parts[0];
            else if (SIGNATURE_SLOT.equals(parts[1])) signatureName = parts[0];
        }
        if (signatureName == null) return Optional.empty();

        String timestamp = null;
        List<String> candidates = new ArrayList<>();
        for (String pair : header.split(",", -1)) {
            int separator = pair.indexOf('=');
            if (separator <= 0) return Optional.empty();

            String name = pair.substring(0, separator).trim();
            String value = pair.substring(separator + 1).trim();
            if (name.equals(timestampName)) {
                if (timestamp != null || !DIGITS.matcher(value).matches()) return Optional.empty();
                timestamp = value;
            } else if (name.equals(signatureName)) {
                if (value.isEmpty()) return Optional.empty();
                candidates.add(value);
            }
        }

        if (candidates.isEmpty() || (timestampName != null && timestamp == null)) return Optional.empty();

        return Optional.of(new SignatureHeader(Optional.ofNullable(timestamp), List.copyOf(candidates)));
    }

    private static Optional<SignatureHeader> prefixed(String format, String header) {
        if (!format.endsWith(SIGNATURE_SLOT)) return Optional.empty();

        String prefix = format.substring(0, format.length() - SIGNATURE_SLOT.length());
        if (!header.startsWith(prefix) || header.length() == prefix.length()) return Optional.empty();

        return Optional.of(new SignatureHeader(Optional.empty(), List.of(header.substring(prefix.length()))));
    }
}
