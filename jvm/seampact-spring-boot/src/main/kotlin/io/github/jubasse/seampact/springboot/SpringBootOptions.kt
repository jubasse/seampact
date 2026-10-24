package io.github.jubasse.seampact.springboot

import javax.lang.model.SourceVersion
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull

/** What a reply outside the contract does (ADR 0016 "Target options"). */
public enum class ResponsesMode(public val wire: String) { STRICT("strict"), WARN("warn") }

/** What happens to an ETag the boundary did not set. */
public enum class FrameworkEtagMode(public val wire: String) { STRIP("strip"), KEEP("keep") }

/** Whether the Spring Security beans are generated, and the opt-in customizer with them (ADR 0022). */
public enum class SpringSecurityMode { OFF, ON, ON_WITH_MATCHERS }

/**
 * The validated options of a spring-boot target entry (ADR 0022 "Options and registration"). [indentSpaces] is the
 * JavaPoet indent. [responses], [bodyValidation], [frameworkEtag] and [catchAll] are the run-time defaults the
 * generated configuration binds.
 */
public data class SpringBootOptions(
    val packageName: String,
    val indentSpaces: Int,
    val responses: ResponsesMode,
    val bodyValidation: Boolean,
    val frameworkEtag: FrameworkEtagMode,
    val catchAll: Boolean,
    val springSecurity: SpringSecurityMode,
) {
    public companion object {
        internal const val DEFAULT_INDENT_SPACES: Int = 4
        private const val MAX_INDENT_SPACES = 8

        private const val PACKAGE = "package"
        private const val INDENT = "indent"
        private const val LAYOUT = "layout"
        private const val RESPONSES = "responses"
        private const val BODY_VALIDATION = "bodyValidation"
        private const val FRAMEWORK_ETAG = "frameworkEtag"
        private const val CATCH_ALL = "catchAll"
        private const val SPRING_SECURITY = "springSecurity"
        private const val MATCHERS = "matchers"
        private const val HANDLERS = "handlers"
        private const val PER_RESOURCE = "perResource"
        private val NAMING_KEYS = listOf("suffixes", "escape", "enumCase")

        private val KNOWN_KEYS = listOf(
            PACKAGE, INDENT, LAYOUT, RESPONSES, BODY_VALIDATION, FRAMEWORK_ETAG, CATCH_ALL, SPRING_SECURITY, HANDLERS,
        ) + NAMING_KEYS

        /** @throws SpringBootRefusedException an unknown key, a missing `package`, or a value outside its set */
        public fun parse(raw: JsonObject): SpringBootOptions {
            val refusals = mutableListOf<SpringBootRefusal>()

            for (key in raw.keys) {
                if (key !in KNOWN_KEYS) refusals += unknownKey(key)
            }

            val packageName = packageOf(raw[PACKAGE], refusals)
            val indentSpaces = indentOf(raw[INDENT], refusals)
            val responses = enumValue(raw, RESPONSES, ResponsesMode.STRICT, ResponsesMode.entries, ResponsesMode::wire, refusals)
            val bodyValidation = booleanValue(raw, BODY_VALIDATION, false, refusals)
            val frameworkEtag = enumValue(raw, FRAMEWORK_ETAG, FrameworkEtagMode.STRIP, FrameworkEtagMode.entries, FrameworkEtagMode::wire, refusals)
            val catchAll = booleanValue(raw, CATCH_ALL, true, refusals)
            val springSecurity = springSecurityOf(raw[SPRING_SECURITY], refusals)

            refuseLayout(raw[LAYOUT], refusals)
            refuseHandlers(raw[HANDLERS], refusals)
            for (key in NAMING_KEYS) {
                if (raw.containsKey(key)) refusals += namingOptionRefused(key)
            }

            if (refusals.isNotEmpty() || packageName == null || indentSpaces == null || responses == null ||
                bodyValidation == null || frameworkEtag == null || catchAll == null || springSecurity == null
            ) {
                throw SpringBootRefusedException(refusals)
            }

            return SpringBootOptions(packageName, indentSpaces, responses, bodyValidation, frameworkEtag, catchAll, springSecurity)
        }

        private fun pointer(key: String): String = "/" + key.replace("~", "~0").replace("/", "~1")

        private fun refusal(code: String, key: String, message: String, fix: String): SpringBootRefusal =
            SpringBootRefusal(code, message, fix, pointer(key))

        private fun unknownKey(key: String): SpringBootRefusal = refusal(
            "options.unknown",
            key,
            "The option '$key' is not one the spring-boot target knows; it takes ${KNOWN_KEYS.joinToString { "'$it'" }}.",
            "Remove '$key' from the target's `options`.",
        )

        private fun packageOf(value: JsonElement?, refusals: MutableList<SpringBootRefusal>): String? {
            if (value == null) {
                refusals += refusal(
                    "options.package.missing",
                    PACKAGE,
                    "The option 'package' is missing; the spring-boot target has no default package.",
                    "Set 'package' to the Java package of the generated code, such as 'com.acme.tasks.api'.",
                )
                return null
            }

            val packageName = (value as? JsonPrimitive)?.takeIf { it.isString }?.content
            if (packageName != null && SourceVersion.isName(packageName, SourceVersion.RELEASE_21)) return packageName

            refusals += refusal(
                "options.package.invalid",
                PACKAGE,
                "The option 'package' is $value, not a Java package name.",
                "Set 'package' to dot-separated Java identifiers that are not keywords, such as 'com.acme.tasks.api'.",
            )
            return null
        }

        private fun indentOf(value: JsonElement?, refusals: MutableList<SpringBootRefusal>): Int? {
            if (value == null) return DEFAULT_INDENT_SPACES

            val spaces = (value as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull
            if (spaces != null && spaces in 1..MAX_INDENT_SPACES) return spaces

            refusals += refusal(
                "options.indent.invalid",
                INDENT,
                "The option 'indent' is $value, not a number of spaces from 1 to $MAX_INDENT_SPACES.",
                "Set 'indent' to a whole number of spaces, or leave it out for $DEFAULT_INDENT_SPACES.",
            )
            return null
        }

        private fun <Mode> enumValue(
            raw: JsonObject,
            key: String,
            default: Mode,
            modes: List<Mode>,
            wireOf: (Mode) -> String,
            refusals: MutableList<SpringBootRefusal>,
        ): Mode? {
            val value = raw[key] ?: return default
            val text = (value as? JsonPrimitive)?.takeIf { it.isString }?.content
            val mode = modes.firstOrNull { wireOf(it) == text }
            if (mode != null) return mode

            refusals += refusal(
                "options.$key.invalid",
                key,
                "The option '$key' is $value, not one of ${modes.joinToString { "'${wireOf(it)}'" }}.",
                "Set '$key' to '${wireOf(default)}' (the default) or another listed value.",
            )
            return null
        }

        private fun booleanValue(raw: JsonObject, key: String, default: Boolean, refusals: MutableList<SpringBootRefusal>): Boolean? {
            val value = raw[key] ?: return default
            val flag = (value as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull
            if (flag != null) return flag

            refusals += refusal(
                "options.$key.invalid",
                key,
                "The option '$key' is $value, not true or false.",
                "Set '$key' to true or false (the default is $default).",
            )
            return null
        }

        private fun springSecurityOf(value: JsonElement?, refusals: MutableList<SpringBootRefusal>): SpringSecurityMode? {
            if (value == null) return SpringSecurityMode.OFF

            val flag = (value as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull
            if (flag != null) return if (flag) SpringSecurityMode.ON else SpringSecurityMode.OFF

            val matchers = (value as? JsonObject)?.takeIf { it.keys == setOf(MATCHERS) }?.get(MATCHERS)
            val matchersFlag = (matchers as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull
            if (matchersFlag != null) return if (matchersFlag) SpringSecurityMode.ON_WITH_MATCHERS else SpringSecurityMode.ON

            refusals += refusal(
                "options.springSecurity.invalid",
                SPRING_SECURITY,
                "The option 'springSecurity' is $value, not true, false or { matchers: true }.",
                "Set 'springSecurity' to true, false or { matchers: true }, or leave it out and let the build plugin read the classpath.",
            )
            return null
        }

        private fun refuseLayout(value: JsonElement?, refusals: MutableList<SpringBootRefusal>) {
            if (value == null) return

            refusals += refusal(
                "options.layout.unsupported",
                LAYOUT,
                "The option 'layout' is $value; the spring-boot target writes one file per public type under its package directory, the only layout Java allows, and takes no other yet.",
                "Remove 'layout' from the target's `options`.",
            )
        }

        private fun refuseHandlers(value: JsonElement?, refusals: MutableList<SpringBootRefusal>) {
            if (value == null || value == JsonPrimitive(PER_RESOURCE)) return

            refusals += refusal(
                "options.handlers.unsupported",
                HANDLERS,
                "The option 'handlers' is $value; the spring-boot target groups operations per resource only (ADR 0007 'perResource'), and 'perTag' and 'perOperation' wait for a consumer.",
                "Set 'handlers' to 'perResource', or leave it out.",
            )
        }

        private fun namingOptionRefused(key: String): SpringBootRefusal = refusal(
            "options.naming.unsupported",
            key,
            "The naming option '$key' is not taken by the spring-boot target yet: it names Java with the defaults of ADR 0007, which the shared naming vectors test.",
            "Remove '$key' from the target's `options`.",
        )
    }
}
