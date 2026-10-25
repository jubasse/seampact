package io.github.jubasse.seampact.springboot

import io.github.jubasse.seampact.ir.model.ArrayTypeUse
import io.github.jubasse.seampact.ir.model.ContractIR
import io.github.jubasse.seampact.ir.model.CredentialIdentity
import io.github.jubasse.seampact.ir.model.IdentityAccess
import io.github.jubasse.seampact.ir.model.ObjectSchema
import io.github.jubasse.seampact.ir.model.Refinements
import io.github.jubasse.seampact.ir.model.ScalarType
import io.github.jubasse.seampact.ir.model.ScalarTypeUse
import io.github.jubasse.seampact.ir.model.TypeUse
import io.github.jubasse.seampact.ir.read.IrReader
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.createDirectories
import kotlin.io.path.deleteExisting
import kotlin.io.path.isRegularFile
import kotlin.io.path.readText
import kotlin.io.path.relativeTo
import kotlin.io.path.writeText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// The reference contract's apis generated with the core-path operations every spring-boot release serves (ADR 0022
// "The consumer and the proof"), compared byte for byte with the committed tree, which `goldenTest` then compiles
// against Spring Boot 4. `-PupdateGolden` rewrites the tree instead.
class SpringBootGoldenTest {
    private val repositoryRoot: Path = Path.of(System.getProperty("seampact.repositoryRoot"))
    private val goldenDirectory: Path = Path.of(System.getProperty("seampact.goldenDirectory"))
    private val updateGolden: Boolean = System.getProperty("seampact.updateGolden").toBoolean()

    private class GoldenApi(val irFile: String, val packageName: String, val operations: Set<String>)

    private val apis = listOf(
        GoldenApi("tasks.ir.json", "com.example.tasks.api", setOf("health", "getChannel", "getDraft", "getTask", "getTasksBatch", "listChannels", "listTasks", "searchTasks")),
        GoldenApi("tasksService.ir.json", "com.example.tasksservice.api", setOf("getTask")),
    )

    private fun referenceIr(file: String): ContractIR {
        val text = repositoryRoot.resolve("fixtures/golden/reference").resolve(file).readText()

        return IrReader.read(text, SpringBootTarget.IR_SUPPORT)
    }

    // What the entry's `operations.include` keeps; the IR view of a build plugin does the same.
    private fun coreView(api: GoldenApi): ContractIR {
        val ir = referenceIr(api.irFile)

        return ir.copy(operations = ir.operations.filter { it.id in api.operations })
    }

    private fun entry(packageName: String): SpringBootEntry =
        SpringBootEntry(id = "server", options = JsonObject(mapOf("package" to JsonPrimitive(packageName))), springBootVersion = "4.1.1")

    private fun generatedTree(): Map<String, String> = apis
        .flatMap { api -> SpringBootTarget.generate(coreView(api), entry(api.packageName)) }
        .associate { it.path to it.contents }

    private fun committedTree(): Map<String, String> {
        if (!Files.isDirectory(goldenDirectory)) return emptyMap()

        return Files.walk(goldenDirectory).use { paths ->
            paths.filter { it.isRegularFile() }
                .toList()
                .associate { it.relativeTo(goldenDirectory).joinToString("/") to it.readText() }
        }
    }

    @Test
    fun generatesTheGoldenTree() {
        val generated = generatedTree()

        if (updateGolden) {
            rewriteGolden(generated)
            return
        }

        val committed = committedTree()
        assertEquals(committed.keys.sorted(), generated.keys.sorted(), "The golden file list differs; run with -PupdateGolden and review the diff.")
        for ((path, contents) in generated) {
            assertEquals(committed[path], contents, "The golden file $path differs; run with -PupdateGolden and review the diff.")
        }
    }

    @Test
    fun generatesTheSameTreeTwice() {
        assertEquals(generatedTree(), generatedTree())
    }

    @Test
    fun refusesTwoTypesOfOnePackageTakingOneName() {
        val api = apis.first()
        val ir = coreView(api)
        val task = ir.schemas.getValue("Task") as ObjectSchema
        val channel = ir.schemas.getValue("Channel") as ObjectSchema
        val collidingIr = ir.copy(schemas = ir.schemas + ("Channel" to channel.copy(name = task.name)))

        val refused = assertFailsWith<SpringBootRefusedException> { SpringBootTarget.generate(collidingIr, entry(api.packageName)) }

        val collision = refused.refusals.single { it.code == "name.collision" }
        assertTrue(collision.message.contains("com.example.tasks.api.schemas.Task"), collision.message)
        assertTrue(collision.message.contains("schema 'Channel'") && collision.message.contains("schema 'Task'"), collision.message)
    }

    @Test
    fun refusesTheFormsOfTheWholeReferenceContractByName() {
        val refused = assertFailsWith<SpringBootRefusedException> {
            SpringBootTarget.generate(referenceIr("tasks.ir.json"), entry("com.example.tasks.api"))
        }

        val codes = refused.refusals.map { it.code }.toSet()
        for (code in listOf("idempotency.unsupported", "cache.unsupported", "signature.unsupported")) {
            assertTrue(code in codes, "expected $code among $codes")
        }
        assertTrue(refused.refusals.all { it.message.contains("spring-") || it.message.contains("waits for") }, refused.message)
        for (code in listOf("concurrency.unsupported", "input.proofs.unsupported", "type.opaque.unsupported")) {
            val refusal = refused.refusals.firstOrNull { it.code == code }
            assertTrue(refusal != null && refusal.message.contains("spring-3"), "expected $code naming spring-3 among ${refused.message}")
        }
    }

    // One Task property added or changed by [change], generated with the core operations.
    private fun taskWith(change: (ObjectSchema) -> ObjectSchema): ContractIR {
        val ir = coreView(apis.first())
        val task = ir.schemas.getValue("Task") as ObjectSchema

        return ir.copy(schemas = ir.schemas + ("Task" to change(task)))
    }

    private fun generatedType(ir: ContractIR, simpleName: String): String =
        SpringBootTarget.generate(ir, entry(apis.first().packageName)).single { it.path.endsWith("/$simpleName.java") }.contents

    private fun refusalsOf(ir: ContractIR): List<SpringBootRefusal> =
        assertFailsWith<SpringBootRefusedException> { SpringBootTarget.generate(ir, entry(apis.first().packageName)) }.refusals

    private fun ObjectSchema.withProperty(name: String, type: TypeUse): ObjectSchema {
        val title = properties.single { it.name == "title" }

        return copy(properties = properties + title.copy(name = name, type = type))
    }

    @Test
    fun readsEveryAccessorThroughThisSoAContextualKeywordMemberCompiles() {
        val title = (coreView(apis.first()).schemas.getValue("Task") as ObjectSchema).properties.single { it.name == "title" }
        val task = generatedType(taskWith { it.withProperty("yield", title.type) }, "Task")

        assertTrue(task.contains("this.yield()") && !Regex("""[^.]\byield\(\)""").containsMatchIn(task), task)
    }

    @Test
    fun redactsSensitiveScalarsInParamsAndArrayItems() {
        val secret = ScalarTypeUse(type = ScalarType.STRING, refinements = Refinements(), sensitive = true)
        val withSecrets = taskWith { it.withProperty("secrets", ArrayTypeUse(items = secret)) }
        val ir = withSecrets.copy(
            operations = withSecrets.operations.map { operation ->
                if (operation.id != "getTask") return@map operation
                val path = operation.params.path.map { if (it.name == "taskId") it.copy(type = secret) else it }
                operation.copy(params = operation.params.copy(path = path))
            },
        )

        assertTrue(generatedType(ir, "Task").contains("secrets=\" + TasksRedaction.REDACTED"), generatedType(ir, "Task"))
        assertTrue(generatedType(ir, "GetTaskPath").contains("taskId=\" + TasksRedaction.REDACTED"), generatedType(ir, "GetTaskPath"))
    }

    @Test
    fun writesADecimalAsABigDecimalKeptAStringOnTheWire() {
        val decimal = ScalarTypeUse(type = ScalarType.STRING, format = "decimal", refinements = Refinements())
        val task = generatedType(taskWith { it.withProperty("amount", decimal) }, "Task")

        assertTrue(task.contains("@JsonFormat(shape = JsonFormat.Shape.STRING) @NotNull BigDecimal amount"), task)
    }

    @Test
    fun keepsAbsentMembersAbsentWhateverTheAppsMapper() {
        assertTrue(generatedType(coreView(apis.first()), "Task").contains("@JsonInclude(JsonInclude.Include.NON_ABSENT)\npublic record Task("))
    }

    @Test
    fun refusesAnIdentityWithNoNameSegment() {
        val ir = coreView(apis.first())
        val renamed = "_"
        val renamedIr = ir.copy(
            identities = ir.identities - "user" + (renamed to (ir.identities.getValue("user") as CredentialIdentity).copy(id = renamed)),
            operations = ir.operations.map { operation ->
                val access = operation.access
                if (access is IdentityAccess && access.identity == "user") operation.copy(access = access.copy(identity = renamed)) else operation
            },
        )

        assertTrue(refusalsOf(renamedIr).any { it.code == "identity.no-segment" && it.member == "/identities/_" })
    }

    @Test
    fun pointsACredentialMemberRefusalAtItsScheme() {
        val ir = coreView(apis.first())
        val user = ir.identities.getValue("user") as CredentialIdentity
        val clashing = user.copy(schemes = user.schemes.copy(read = user.schemes.read + "Bearer"))

        val collision = refusalsOf(ir.copy(identities = ir.identities + ("user" to clashing))).single { it.code == "name.collision" }
        assertEquals("/schemes/Bearer", collision.member)
    }

    @Test
    fun refusesAnOperationWhoseEndpointsHaveNoOwnerName() {
        val ir = coreView(apis.first())
        val ownerless = ir.copy(operations = ir.operations.map { if (it.id == "health") it.copy(resource = null, surface = "_") else it })

        assertTrue(refusalsOf(ownerless).any { it.code == "endpoints.owner.no-segment" && it.operation == "health" })
    }

    private fun rewriteGolden(generated: Map<String, String>) {
        for (stale in committedTree().keys - generated.keys) goldenDirectory.resolve(stale).deleteExisting()

        for ((path, contents) in generated) {
            val file = goldenDirectory.resolve(path)
            file.parent.createDirectories()
            file.writeText(contents)
        }
    }
}
