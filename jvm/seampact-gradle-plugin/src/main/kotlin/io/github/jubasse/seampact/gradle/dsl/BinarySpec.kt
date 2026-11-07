package io.github.jubasse.seampact.gradle.dsl

import org.gradle.api.file.RegularFileProperty
import org.gradle.api.provider.MapProperty
import org.gradle.api.provider.Property

/**
 * The build file's override of the compiler binary the plugin pins (ADR 0010 "Pin"): another release, `version`
 * with the SHA-256 of its binary on every platform by classifier (`sha256ByClassifier`), or the consumer's own build,
 * `path` with its `sha256`. An override without its hash is refused (`binary.pin-missing`).
 */
public abstract class BinarySpec {
    public abstract val version: Property<String>
    public abstract val sha256ByClassifier: MapProperty<String, String>
    public abstract val path: RegularFileProperty
    public abstract val sha256: Property<String>
}
