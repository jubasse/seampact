package io.github.jubasse.seampact.springboot.runtime;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Optional;
import java.util.Set;
import org.springframework.core.env.Environment;

/**
 * The origin absolute URLs start with (`api.wire.urls: absolute`, ADR 0022 "Absolute URLs"): the property
 * `seampact.<api>.public-origin`, a scheme, a host and an optional port. The request's `Host` and forwarded headers
 * are never read.
 */
final class PublicOrigin {
    private static final String ABSOLUTE_URLS = "absolute";
    private static final Set<String> SCHEMES = Set.of("http", "https");

    private PublicOrigin() {}

    static boolean writesAbsoluteUrls(ContractTable table) {
        return ABSOLUTE_URLS.equals(table.ir().path("api").path("wire").path("urls").asString());
    }

    static String propertyOf(ContractTable table) {
        return "seampact." + table.apiId() + ".public-origin";
    }

    /** The configured origin under absolute URLs; empty under relative ones, or when the boot check refuses it. */
    static Optional<String> of(ContractTable table, Environment environment) {
        if (!writesAbsoluteUrls(table)) return Optional.empty();

        String configured = environment.getProperty(propertyOf(table));
        if (configured == null || problemOf(configured).isPresent()) return Optional.empty();
        return Optional.of(configured);
    }

    /** The boot check's problem with the origin, when the api writes absolute URLs. */
    static Optional<String> bootProblem(ContractTable table, Environment environment) {
        if (!writesAbsoluteUrls(table)) return Optional.empty();

        String property = propertyOf(table);
        String configured = environment.getProperty(property);
        if (configured == null) {
            return Optional.of("the api writes absolute URLs ('api.wire.urls: absolute') and '" + property
                    + "' is not set; fix: set it to the origin clients call, such as https://api.example.com.");
        }

        return problemOf(configured).map(reason -> "'" + property + "' is '" + configured + "', which " + reason
                + "; fix: set a scheme (http or https), a host and an optional port, such as https://api.example.com.");
    }

    private static Optional<String> problemOf(String configured) {
        URI origin;
        try {
            origin = new URI(configured);
        } catch (URISyntaxException failure) {
            return Optional.of("is not a URI (" + failure.getReason() + ")");
        }

        if (origin.getScheme() == null || !SCHEMES.contains(origin.getScheme())) return Optional.of("has no http or https scheme");
        if (origin.getHost() == null) return Optional.of("has no host");
        if (origin.getRawUserInfo() != null) return Optional.of("carries user info");

        boolean onlyOrigin = origin.getRawPath().isEmpty() && origin.getRawQuery() == null && origin.getRawFragment() == null;
        if (!onlyOrigin) return Optional.of("has a path, a query or a fragment (a trailing slash included)");
        return Optional.empty();
    }
}
