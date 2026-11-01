package io.github.jubasse.seampact.springboot.runtime;

import java.util.Optional;
import java.util.Set;
import org.springframework.core.env.Environment;

/**
 * The property `seampact.<api>.unbound-operations` (ADR 0022 "The boot check"): `error`, the default, refuses to start
 * when an operation has no handler; `warn` lets a test slice that loads some controllers (`@WebMvcTest`) start, logs
 * the unbound operations once and answers their routes with the api's 404. `warn` holds even when
 * `artefacts.bootCheck` switches the handler check off; `error` refuses only when that check is on.
 */
final class UnboundOperations {
    static final String ERROR = "error";
    static final String WARN = "warn";

    private static final Set<String> VALUES = Set.of(ERROR, WARN);

    private UnboundOperations() {}

    static String propertyOf(String apiId) {
        return "seampact." + apiId + ".unbound-operations";
    }

    /** True only under `warn`; a value the boot check refuses reads as the default. */
    static boolean warns(String apiId, Environment environment) {
        return WARN.equals(environment.getProperty(propertyOf(apiId)));
    }

    /** The boot check's problem with a value other than `error` or `warn`. */
    static Optional<String> bootProblem(String apiId, Environment environment) {
        String property = propertyOf(apiId);
        String configured = environment.getProperty(property);
        if (configured == null || VALUES.contains(configured)) return Optional.empty();

        return Optional.of("'" + property + "' is '" + configured + "', not 'error' or 'warn'; fix: set it to 'warn' in a test slice"
                + " that loads some controllers, or remove it.");
    }
}
