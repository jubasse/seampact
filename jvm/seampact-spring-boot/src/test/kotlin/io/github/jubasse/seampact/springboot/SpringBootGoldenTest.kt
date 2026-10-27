package io.github.jubasse.seampact.springboot

import io.github.jubasse.seampact.ir.model.Access
import io.github.jubasse.seampact.ir.model.ArrayTypeUse
import io.github.jubasse.seampact.ir.model.ContractIR
import io.github.jubasse.seampact.ir.model.CredentialIdentity
import io.github.jubasse.seampact.ir.model.EachTemplate
import io.github.jubasse.seampact.ir.model.HeaderTemplate
import io.github.jubasse.seampact.ir.model.IdentityAccess
import io.github.jubasse.seampact.ir.model.LiteralTemplate
import io.github.jubasse.seampact.ir.model.MetaFill
import io.github.jubasse.seampact.ir.model.MetaMember
import io.github.jubasse.seampact.ir.model.ObjectSchema
import io.github.jubasse.seampact.ir.model.ObjectTemplate
import io.github.jubasse.seampact.ir.model.ObjectTemplateMember
import io.github.jubasse.seampact.ir.model.Operation
import io.github.jubasse.seampact.ir.model.OptionalAccess
import io.github.jubasse.seampact.ir.model.PlainMemberName
import io.github.jubasse.seampact.ir.model.PublicAccess
import io.github.jubasse.seampact.ir.model.RefusedCredential
import io.github.jubasse.seampact.ir.model.Refinements
import io.github.jubasse.seampact.ir.model.ScalarType
import io.github.jubasse.seampact.ir.model.ScalarTypeUse
import io.github.jubasse.seampact.ir.model.SlotMemberName
import io.github.jubasse.seampact.ir.model.SlotTemplate
import io.github.jubasse.seampact.ir.model.SlotTextPart
import io.github.jubasse.seampact.ir.model.Template
import io.github.jubasse.seampact.ir.model.TextTemplate
import io.github.jubasse.seampact.ir.model.WireFormat
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
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// The reference contract's apis generated with the core-path operations every spring-boot release serves (ADR 0022
// "The consumer and the proof"), compared byte for byte with the committed tree, which `goldenTest` then compiles
// against Spring Boot 4. `-PupdateGolden` rewrites the tree instead. The main tree keeps every default, as both build
// plugins write it; the opt-ins tree holds the tasksService api, in a package of its own, with every opt-in of spring-4.
private const val TASKS_SERVICE_IR = "tasksService.ir.json"
private const val OPT_INS_PACKAGE = "com.example.optins.api"

class SpringBootGoldenTest {
    private val repositoryRoot: Path = Path.of(System.getProperty("seampact.repositoryRoot"))
    private val goldenDirectory: Path = Path.of(System.getProperty("seampact.goldenDirectory"))
    private val optInsGoldenDirectory: Path = Path.of(System.getProperty("seampact.optInsGoldenDirectory"))
    private val updateGolden: Boolean = System.getProperty("seampact.updateGolden").toBoolean()

    private class GoldenApi(val irFile: String, val packageName: String, val operations: Set<String>)

    private val apis = listOf(
        GoldenApi("tasks.ir.json", "com.example.tasks.api", setOf("health", "getChannel", "getDraft", "deleteDraft", "getPreferences", "updatePreferences", "getTask", "createTask", "updateTask", "assignTask", "archiveTask", "purgeTask", "getTasksBatch", "listChannels", "listTasks", "searchTasks", "payments")),
        GoldenApi(TASKS_SERVICE_IR, "com.example.tasksservice.api", setOf("getTask")),
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
        SpringBootEntry(id = "server", options = JsonObject(mapOf("package" to JsonPrimitive(packageName))))

    // The Spring Security beans with the customizer, springdoc's annotations and `frameworkDocs: off`.
    private fun optInsEntry(packageName: String): SpringBootEntry {
        val entry = entry(packageName)
        val matchers = JsonObject(mapOf("matchers" to JsonPrimitive(true)))

        return entry.copy(
            options = JsonObject(entry.options + ("springSecurity" to matchers)),
            artefacts = JsonObject(mapOf("nativeDocs" to JsonPrimitive(true))),
            frameworkDocs = "off",
        )
    }

    private fun generatedTree(): Map<String, String> = apis
        .flatMap { api -> SpringBootTarget.generate(coreView(api), entry(api.packageName)) }
        .associate { it.path to it.contents }

    private fun optInsTree(): Map<String, String> {
        val api = apis.single { it.irFile == TASKS_SERVICE_IR }

        return SpringBootTarget.generate(withEveryAccessKind(coreView(api)), optInsEntry(OPT_INS_PACKAGE)).associate { it.path to it.contents }
    }

    // Copies of getTask under each access kind the Spring Security matchers group: a public template whose `{area}`
    // also covers getTask's literal `channels` segment, an optional-auth route that calls anonymously on a refused
    // credential, and a route a signed identity calls.
    private fun withEveryAccessKind(ir: ContractIR): ContractIR {
        val getTask = ir.operations.single { it.id == "getTask" }
        val origin = (getTask.access as IdentityAccess).origin
        val areaParam = getTask.params.path.first().copy(name = "area")

        val browseTask = getTask.variant("browse", "/internal/v1/{area}/{channelId}/tasks/{taskId}", PublicAccess(reason = "Shared links open it.", origin = origin))
            .let { it.copy(params = it.params.copy(path = listOf(areaParam) + it.params.path)) }
        val peekTask = getTask.variant(
            "peek",
            "/internal/v1/channels/{channelId}/peeks/{taskId}",
            OptionalAccess(identity = "service", schemes = listOf("internalToken"), reason = "Previews open it.", onRefused = RefusedCredential.ANONYMOUS, origin = origin),
        )
        val signTask = getTask.variant("sign", "/internal/v1/channels/{channelId}/signed/{taskId}", IdentityAccess(identity = "stripe", schemes = listOf("stripeSignature"), origin = origin))

        return ir.copy(operations = ir.operations + listOf(browseTask, peekTask, signTask))
    }

    private fun Operation.variant(verb: String, path: String, access: Access): Operation =
        copy(id = "${verb}Task", name = name.copy(segments = listOf(verb, "task")), path = path, access = access)

    private fun committedTree(directory: Path): Map<String, String> {
        if (!Files.isDirectory(directory)) return emptyMap()

        return Files.walk(directory).use { paths ->
            paths.filter { it.isRegularFile() }
                .toList()
                .associate { it.relativeTo(directory).joinToString("/") to it.readText() }
        }
    }

    @Test
    fun generatesTheGoldenTree() {
        compareWithGolden(generatedTree(), goldenDirectory)
    }

    @Test
    fun generatesTheOptInsGoldenTree() {
        compareWithGolden(optInsTree(), optInsGoldenDirectory)
    }

    private fun compareWithGolden(generated: Map<String, String>, directory: Path) {
        if (updateGolden) {
            rewriteGolden(generated, directory)
            return
        }

        val committed = committedTree(directory)
        assertEquals(committed.keys.sorted(), generated.keys.sorted(), "The golden file list differs; run with -PupdateGolden and review the diff.")
        for ((path, contents) in generated) {
            assertEquals(committed[path], contents, "The golden file $path differs; run with -PupdateGolden and review the diff.")
        }
    }

    @Test
    fun generatesTheSameTreeTwice() {
        assertEquals(generatedTree(), generatedTree())
        assertEquals(optInsTree(), optInsTree())
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

    // A sort key reaches Spring Data as the Java member of the item it names, since the entity's property is that member.
    @Test
    fun mapsTheSpringPageSortKeysToTheItemsJavaMembers() {
        val packSpringText = repositoryRoot.resolve("fixtures/golden/pack-spring/tasks.ir.json").readText()
        val snakeCaseSortKey = packSpringText.replace("\"createdAt\"", "\"created_at\"")
        val generated = SpringBootTarget.generate(IrReader.read(snakeCaseSortKey, SpringBootTarget.IR_SUPPORT), entry("com.example.tasks.api"))

        val binding = generated.single { it.path.endsWith("SeampactBinding.java") }.contents
        assertTrue("Map.entry(\"created_at\", \"createdAt\")" in binding, binding)
    }

    @Test
    fun generatesTheWholeReferenceContract() {
        for (api in apis) {
            val ir = referenceIr(api.irFile)
            assertEquals(ir.operations.map { it.id }.toSet(), api.operations, "the golden view of ${api.irFile} keeps every operation")
            SpringBootTarget.generate(ir, entry(api.packageName))
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

    // The boundary matches the raw path, so a static segment a client percent-encodes would never be served.
    @Test
    fun refusesAStaticSegmentAClientSendsPercentEncoded() {
        val ir = coreView(apis.first())

        for (segment in listOf("my tasks", "tâches", "a^b", "a\\b", "a|b", "a[b", "a]b")) {
            val encoded = ir.copy(operations = ir.operations.map { if (it.id == "health") it.copy(path = "/v1/$segment") else it })

            val refusal = refusalsOf(encoded).single { it.code == "path.segment.encoded.unsupported" }
            assertTrue(refusal.message.contains("The static path segment '$segment', which a client sends percent-encoded"), refusal.message)
            assertEquals("health", refusal.operation)
        }
    }

    @Test
    fun escapesAControlCharacterInARefusedStaticSegmentAndNamesTheFix() {
        val ir = coreView(apis.first())
        val encoded = ir.copy(operations = ir.operations.map { if (it.id == "health") it.copy(path = "/v1/a\u0007b") else it })

        val refusal = refusalsOf(encoded).single { it.code == "path.segment.encoded.unsupported" }

        assertTrue(refusal.message.contains("'a\\u0007b'"), refusal.message)
        assertFalse(refusal.message.contains("\u0007"), refusal.message)
        assertEquals("Use plain ASCII letters, digits and '-' in that path part.", refusal.fix)
    }

    @Test
    fun refusesASortKeyRestrictedByARight() {
        val ir = coreView(apis.first())
        val restricted = ir.copy(operations = ir.operations.map { operation ->
            val paging = operation.paging
            if (operation.id != "listTasks" || paging == null) return@map operation
            operation.copy(paging = paging.copy(sortKeys = paging.sortKeys.map { it.copy(right = "tasks.seeEffort") }))
        })

        val refusal = refusalsOf(restricted).single { it.code == "paging.sortKey.right.unsupported" }
        assertTrue(refusal.message.contains("The sort key 'createdAt' restricted by the right 'tasks.seeEffort'"), refusal.message)
        assertEquals("listTasks", refusal.operation)
    }

    @Test
    fun refusesASuccessEnvelopeThatNeverWritesThePayload() {
        val ir = coreView(apis.first())
        val bare = ir.formats.getValue("bare")
        val noPayload = ObjectTemplate(members = listOf(ObjectTemplateMember(PlainMemberName(text = "data"), LiteralTemplate(value = JsonPrimitive("none")))))
        val withoutPayload = bare.copy(success = bare.success.copy(item = bare.success.item.copy(body = noPayload)))

        val refusal = refusalsOf(ir.copy(formats = ir.formats + ("bare" to withoutPayload))).single { it.code == "format.success.envelope.unsupported" }
        assertEquals("/formats/bare/success/item/body", refusal.member)
    }

    @Test
    fun acceptsAPageThatWritesTheEachBoundItemInText() {
        val itemId = TextTemplate(parts = listOf(SlotTextPart(slot = "item", path = listOf("id"))))
        val pageBody = namedMembers("data" to EachTemplate(of = "items", as_ = namedMembers("id" to itemId)))

        val generated = SpringBootTarget.generate(withCursorPageBody(pageBody), entry(apis.first().packageName))
        assertTrue(generated.isNotEmpty())
    }

    @Test
    fun refusesPageSlotsWrittenInTextOrAsAMemberName() {
        val resourceText = TextTemplate(parts = listOf(SlotTextPart(slot = "resource", path = emptyList())))
        val collectionMember = ObjectTemplateMember(SlotMemberName(slot = "collection"), SlotTemplate(slot = "items", path = emptyList()))
        val pageBody = ObjectTemplate(members = listOf(collectionMember, ObjectTemplateMember(PlainMemberName(text = "self"), resourceText)))

        val refusal = refusalsOf(withCursorPageBody(pageBody)).single { it.code == "paging.response.slot.unsupported" }
        assertTrue(refusal.message.contains("The page slots '\$collection', '\$resource' of the paging style 'cursor'"), refusal.message)
    }

    @Test
    fun refusesASuccessEnvelopeSlotBesideThePayload() {
        val envelope = namedMembers("data" to SlotTemplate(slot = "payload", path = emptyList()), "self" to SlotTemplate(slot = "resource", path = emptyList()))

        val refusal = refusalsOf(withBareFormat { it.copy(success = it.success.copy(item = it.success.item.copy(body = envelope))) }).single { it.code == "format.success.slot.unsupported" }
        assertTrue(refusal.message.contains("The success envelope slot '\$resource'"), refusal.message)
        assertEquals("/formats/bare/success/item/body", refusal.member)
    }

    @Test
    fun refusesASuccessFormatHeader() {
        val header = HeaderTemplate(name = "X-Envelope", value = LiteralTemplate(value = JsonPrimitive("1")))

        val refusal = refusalsOf(withBareFormat { it.copy(success = it.success.copy(item = it.success.item.copy(headers = listOf(header)))) }).single { it.code == "format.success.headers.unsupported" }
        assertEquals("/formats/bare/success/item/headers", refusal.member)
    }

    @Test
    fun refusesTheFormatMetaMembers() {
        val generatedAt = MetaMember(type = ScalarTypeUse(type = ScalarType.STRING, refinements = Refinements()), fill = MetaFill.NOW)

        val refusal = refusalsOf(withBareFormat { it.copy(meta = mapOf("generatedAt" to generatedAt)) }).single { it.code == "format.meta.unsupported" }
        assertEquals("/formats/bare/meta", refusal.member)
    }

    private fun namedMembers(vararg members: Pair<String, Template>): ObjectTemplate =
        ObjectTemplate(members = members.map { (name, value) -> ObjectTemplateMember(PlainMemberName(text = name), value) })

    private fun withCursorPageBody(body: Template): ContractIR {
        val ir = coreView(apis.first())
        val cursor = ir.pagings.getValue("cursor")

        return ir.copy(pagings = ir.pagings + ("cursor" to cursor.copy(response = cursor.response.copy(body = body))))
    }

    private fun withBareFormat(change: (WireFormat) -> WireFormat): ContractIR {
        val ir = coreView(apis.first())

        return ir.copy(formats = ir.formats + ("bare" to change(ir.formats.getValue("bare"))))
    }

    private fun rewriteGolden(generated: Map<String, String>, directory: Path) {
        for (stale in committedTree(directory).keys - generated.keys) directory.resolve(stale).deleteExisting()

        for ((path, contents) in generated) {
            val file = directory.resolve(path)
            file.parent.createDirectories()
            file.writeText(contents)
        }
    }
}
