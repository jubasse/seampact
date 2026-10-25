package io.github.jubasse.seampact.maven

import io.github.jubasse.seampact.runner.BinarySettings
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

// The `<binary>` pin override reads each setting once, or refuses the element by name.
class BinaryElementTest {
    private val appDirectory = Path.of("/app")

    private val evaluate: (String) -> String? = { text -> text.replace("\${binaryVersion}", "1.4.0").takeUnless { "\${" in it } }

    @Test
    fun readsTheVersionWithItsHashesAndThePathWithItsHash() {
        val read = read(
            """
            <binary>
              <version>${'$'}{binaryVersion}</version>
              <sha256ByClassifier><linux-x86_64>aaa</linux-x86_64></sha256ByClassifier>
              <path>bin/seampact</path>
              <sha256>bbb</sha256>
            </binary>
            """,
        )

        assertEquals(BinaryElementRead.Read(BinarySettings("1.4.0", mapOf("linux-x86_64" to "aaa"), "/app/bin/seampact", "bbb")), read)
    }

    @Test
    fun refusesTextRepeatedChildrenAttributesAndUnresolvedExpressions() {
        val wheres = listOf(
            "<binary>/opt/seampact</binary>",
            "<binary><sha256ByClassifier><linux-x86_64>a</linux-x86_64><linux-x86_64>b</linux-x86_64></sha256ByClassifier></binary>",
            "<binary><path>a</path><path>b</path><sha256>c</sha256></binary>",
            "<binary><path implementation=\"x\">a</path><sha256>c</sha256></binary>",
            "<binary><version>${'$'}{missing}</version></binary>",
        ).map { xml -> assertIs<BinaryElementRead.Refused>(read(xml)).problems.single() }

        assertEquals(
            listOf(
                "<configuration>/binary",
                "<configuration>/binary/sha256ByClassifier/linux-x86_64",
                "<configuration>/binary/path",
                "<configuration>/binary/path",
                "<configuration>/binary/version",
            ),
            wheres.map { it.where },
        )
        assertEquals(setOf(ConfigurationConverter.SHAPE_CODE), wheres.map { it.code }.toSet())
    }

    private fun read(xml: String): BinaryElementRead = BinaryElement.read(plexusConfiguration(xml), evaluate, appDirectory)
}
