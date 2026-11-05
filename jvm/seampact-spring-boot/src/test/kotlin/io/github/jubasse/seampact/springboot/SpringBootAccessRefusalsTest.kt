package io.github.jubasse.seampact.springboot

import io.github.jubasse.seampact.ir.model.Binding
import io.github.jubasse.seampact.ir.model.ContractIR
import io.github.jubasse.seampact.ir.model.CredentialIdentity
import io.github.jubasse.seampact.ir.model.IdentityAccess
import io.github.jubasse.seampact.ir.model.Operation
import io.github.jubasse.seampact.ir.model.Origin
import io.github.jubasse.seampact.ir.model.PrincipalRequirement
import io.github.jubasse.seampact.ir.model.ValueSource
import io.github.jubasse.seampact.ir.model.ValueSourceIn
import io.github.jubasse.seampact.ir.model.VariantsPrincipal
import io.github.jubasse.seampact.ir.read.IrReader
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.assertFailsWith
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// The access forms 1.0 refuses by name (CHK-006, 019, 020, 094): a contract that uses one fails at generation with
// the form's code.
class SpringBootAccessRefusalsTest {
    private val repositoryRoot: Path = Path.of(System.getProperty("seampact.repositoryRoot"))
    private val origin = Origin(layer = "api", pointer = "/access")

    private fun getTaskIr(): ContractIR {
        val text = Files.readString(repositoryRoot.resolve("fixtures/golden/reference/tasks.ir.json"))
        val ir = IrReader.read(text, SpringBootTarget.IR_SUPPORT)

        return ir.copy(operations = ir.operations.filter { it.id == "getTask" })
    }

    private fun refusedCodes(ir: ContractIR): List<String> {
        val entry = SpringBootEntry(id = "server", options = JsonObject(mapOf("package" to JsonPrimitive("com.acme.tasks"))))

        return assertFailsWith<SpringBootRefusedException> { SpringBootTarget.generate(ir, entry) }.refusals.map { it.code }
    }

    private fun referenceIr(vararg operationIds: String): ContractIR {
        val ir = IrReader.read(Files.readString(repositoryRoot.resolve("fixtures/golden/reference/tasks.ir.json")), SpringBootTarget.IR_SUPPORT)

        return ir.copy(operations = ir.operations.filter { it.id in operationIds })
    }

    private fun ContractIR.withGetTask(change: (Operation) -> Operation): ContractIR = copy(operations = operations.map(change))

    @Test
    fun refusesAPrincipalRequirement() {
        val ir = getTaskIr().withGetTask { it.copy(principalRequires = listOf(PrincipalRequirement("verified", origin))) }

        assertTrue("principalRequires.unsupported" in refusedCodes(ir))
    }

    @Test
    fun refusesAPrincipalBinding() {
        val binding = Binding(ValueSource(ValueSourceIn.BODY, "ownerId"), ValueSource(ValueSourceIn.PRINCIPAL, "profileId"), origin)
        val ir = getTaskIr().withGetTask { it.copy(bindings = listOf(binding)) }

        assertTrue("bindings.unsupported" in refusedCodes(ir))
    }

    @Test
    fun refusesAScopeResolvedByTheApplication() {
        val ir = getTaskIr().withGetTask { operation ->
            operation.copy(scopes = operation.scopes.map { it.copy(source = ValueSource(ValueSourceIn.RESOLVER)) })
        }

        assertTrue("scope.source.unsupported" in refusedCodes(ir))
    }

    @Test
    fun refusesAPrincipalWithVariants() {
        val base = getTaskIr()
        val identityId = (base.operations.single().access as IdentityAccess).identity
        val identity = base.identities.getValue(identityId) as CredentialIdentity
        val variants = identity.copy(principal = VariantsPrincipal(variants = mapOf("viewer" to "UserPrincipal")))
        val ir = base.copy(identities = base.identities + (identityId to variants))

        assertTrue("principal.variants.unsupported" in refusedCodes(ir))
    }

    @Test
    fun refusesOnceTheExtensionValuesOfAnAskedRightRuleOrScope() {
        val base = referenceIr("assignTask", "createTask")
        val extensions = JsonObject(mapOf("acme" to JsonObject(mapOf("audit" to JsonPrimitive("on")))))
        val ir = base.copy(
            rights = base.rights + ("roles" to base.rights.getValue("roles").copy(extensions = extensions)),
            rules = base.rules + ("throttle" to base.rules.getValue("throttle").copy(extensions = extensions)),
            scopes = base.scopes + ("channel" to base.scopes.getValue("channel").copy(extensions = extensions)),
        )

        val extensionCodes = refusedCodes(ir).filter { it.endsWith(".extensions.unsupported") }

        assertEquals(listOf("right.extensions.unsupported", "rule.extensions.unsupported", "scope.extensions.unsupported"), extensionCodes.sorted())
    }

    @Test
    fun bindsTheParamsRecordOfEachAskedRightThatDeclaresParams() {
        val entry = SpringBootEntry(id = "server", options = JsonObject(mapOf("package" to JsonPrimitive("com.acme.tasks"))))
        val files = SpringBootTarget.generate(referenceIr("assignTask", "searchTasks"), entry)

        val binding = files.single { it.path.endsWith("SeampactBinding.java") }.contents
        assertTrue(files.any { it.path.endsWith("/RolesParams.java") }, "the params record of 'roles' is generated")
        assertTrue(Regex("""rightParamsTypes\(\) \{\s+return Map\.ofEntries\(\s+Map\.entry\("roles", RolesParams\.class\)\);""") in binding, binding)
    }
}
