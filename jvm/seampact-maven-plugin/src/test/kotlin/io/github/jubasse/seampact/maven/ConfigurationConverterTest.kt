package io.github.jubasse.seampact.maven

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.codehaus.plexus.configuration.PlexusConfiguration
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

// The `<configuration>` elements become the JSON tree a `seampact.config.yaml` gives, typed by `app.schema.json`.
class ConfigurationConverterTest {
    private val properties = mapOf("contractDirectory" to "../contract")

    private val converter = ConfigurationConverter(ConfigurationConverter.appSchema) { text ->
        val evaluated = properties.entries.fold(text) { partly, (name, value) -> partly.replace("\${$name}", value) }
        evaluated.takeUnless { "\${" in it }
    }

    @Test
    fun everyKeyOfTheAppSchemaIsAConfigurationParameter() {
        val schemaKeys = ConfigurationConverter.appSchema.getValue("properties").jsonObject.keys
        val parameters = SeampactMojo::class.java.declaredFields
            .filter { it.type == PlexusConfiguration::class.java }
            .map { it.name }
            .toSet()

        assertEquals(schemaKeys + "binary", parameters)
    }

    @Test
    fun convertsEachValueToTheTypeTheSchemaGivesIt() {
        val converted = converter.convert(
            elements(
                "<allowLocal>false</allowLocal>",
                "<outDir>target/generated-sources/seampact</outDir>",
                "<sources><contract><path>\${contractDirectory}</path></contract></sources>",
                """
                <targets>
                  <target>
                    <id>server</id>
                    <use>io.github.jubasse:seampact-spring-boot</use>
                    <api>tasks</api>
                    <operations><include><operation>getTask</operation></include><exclude/></operations>
                    <options><package>com.example.api</package><indent>2</indent><bodyValidation>true</bodyValidation></options>
                    <artefacts><accessHooks>false</accessHooks><bootCheck><hooks>warn</hooks></bootCheck></artefacts>
                    <frameworkRoutes><route><path>/actuator/**</path><reason>Health checks.</reason></route></frameworkRoutes>
                  </target>
                </targets>
                """,
                "<openapi>none</openapi>",
                "<checks combine.children=\"append\"><generated>disabled</generated></checks>",
            ),
        )

        val expected = """
            {
              "allowLocal": false,
              "outDir": "target/generated-sources/seampact",
              "sources": { "contract": { "path": "../contract" } },
              "targets": [
                {
                  "id": "server",
                  "use": "io.github.jubasse:seampact-spring-boot",
                  "api": "tasks",
                  "operations": { "include": ["getTask"], "exclude": [] },
                  "options": { "package": "com.example.api", "indent": 2, "bodyValidation": true },
                  "artefacts": { "accessHooks": false, "bootCheck": { "hooks": "warn" } },
                  "frameworkRoutes": [{ "path": "/actuator/**", "reason": "Health checks." }]
                }
              ],
              "openapi": "none",
              "checks": { "generated": "disabled" }
            }
            """
        assertEquals(ConversionOutcome.Converted(json(expected)), converted)
    }

    @Test
    fun alternativesOfDifferentTypesAreToldApartByTheirForm() {
        val converted = converter.convert(
            elements(
                """
                <openapi>
                  <tasks><path>openapi/tasks.json</path><extensions>all</extensions></tasks>
                  <tasksService><path>openapi/service.json</path><extensions><extension>x-a</extension></extensions></tasksService>
                </openapi>
                """,
            ),
        )

        val expected = """
            {
              "openapi": {
                "tasks": { "path": "openapi/tasks.json", "extensions": "all" },
                "tasksService": { "path": "openapi/service.json", "extensions": ["x-a"] }
              }
            }
            """
        assertEquals(ConversionOutcome.Converted(json(expected)), converted)
    }

    @Test
    fun refusesWhatHasNoJsonFormNamingTheElement() {
        val converted = converter.convert(
            elements(
                "<allowLocal>maybe</allowLocal>",
                "<sources source=\"x\"><contract><path>a</path></contract></sources>",
                "<checks><generated>error</generated><generated>warning</generated></checks>",
                "<outDir>\${missing}</outDir>",
            ),
        )

        val refused = assertIs<ConversionOutcome.Refused>(converted)
        assertEquals(
            listOf(
                "<configuration>/allowLocal",
                "<configuration>/sources",
                "<configuration>/checks/generated",
                "<configuration>/outDir",
            ),
            refused.problems.map { it.where },
        )
        assertEquals(setOf(ConfigurationConverter.SHAPE_CODE), refused.problems.map { it.code }.toSet())
    }

    @Test
    fun readsTheBooleanSpellingsYamlReads() {
        val converted = converter.convert(elements("<allowLocal>TRUE</allowLocal>"))

        assertEquals(ConversionOutcome.Converted(json("""{ "allowLocal": true }""")), converted)
    }

    private fun elements(vararg xml: String): List<PlexusConfiguration> = xml.map(::plexusConfiguration)

    private fun json(text: String): JsonObject = Json.parseToJsonElement(text).jsonObject
}
