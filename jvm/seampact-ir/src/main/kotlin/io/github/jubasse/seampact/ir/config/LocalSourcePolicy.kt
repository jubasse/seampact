package io.github.jubasse.seampact.ir.config

/**
 * Refusing local sources on shared branches (ADR 0011): `allowLocal` in the config, true when absent, and the
 * environment variable `SEAMPACT_ALLOW_LOCAL`, whose `false` forces the refusal and whose other values never lift a
 * `false` the config holds. A local source is a `path` source, or a git bundle source naming a local repository.
 */
public enum class LocalSourcePolicy {
    ALLOW,
    REFUSE,
    ;

    public companion object {
        public const val ALLOW_LOCAL_VARIABLE: String = "SEAMPACT_ALLOW_LOCAL"

        private const val FORCED_REFUSAL = "false"

        /** The policy of a config whose `allowLocal` is [configured], under [environment]. */
        public fun of(configured: Boolean?, environment: Map<String, String>): LocalSourcePolicy =
            if (environment[ALLOW_LOCAL_VARIABLE] == FORCED_REFUSAL || configured == false) REFUSE else ALLOW

        /** Which setting refuses local sources, for a message: the environment variable wins. */
        public fun refusalReason(environment: Map<String, String>): String =
            if (environment[ALLOW_LOCAL_VARIABLE] == FORCED_REFUSAL) "$ALLOW_LOCAL_VARIABLE=$FORCED_REFUSAL" else "allowLocal: false"
    }
}
