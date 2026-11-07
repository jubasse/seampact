// The build-time writer of the binary pins a plugin jar embeds (ADR 0010 "Pin").
package io.github.jubasse.seampact.runner.pins

import io.github.jubasse.seampact.ir.binary.BinaryPins
import io.github.jubasse.seampact.ir.binary.BinaryPinsRead
import java.nio.file.Path
import kotlin.io.path.createParentDirectories
import kotlin.io.path.readText
import kotlin.io.path.writeText
import kotlin.system.exitProcess

/** Writes `seampact-binaries.properties` from `<version> <SHA256SUMS> <output>`, refusing a manifest that does not pin every platform. */
public fun main(arguments: Array<String>) {
    val (version, sums, output) = arguments

    when (val read = BinaryPins.fromSha256Sums(version, Path.of(sums).readText())) {
        is BinaryPinsRead.Read -> Path.of(output).createParentDirectories().writeText(read.pins.toProperties())
        is BinaryPinsRead.Refused -> {
            System.err.println("${read.failure.code.code}: ${read.failure.message} ${read.failure.fix}")
            exitProcess(1)
        }
    }
}
