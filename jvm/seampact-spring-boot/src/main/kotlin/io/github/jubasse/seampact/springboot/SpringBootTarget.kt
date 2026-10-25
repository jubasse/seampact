package io.github.jubasse.seampact.springboot

import com.palantir.javapoet.JavaFile
import com.palantir.javapoet.TypeSpec
import io.github.jubasse.seampact.ir.model.ContractIR
import io.github.jubasse.seampact.ir.read.IrSupport

private const val FRAMEWORK_DOCS_OFF = "off"
private const val SPRINGDOC_API_DOCS_ENABLED = "springdoc.api-docs.enabled"

/** One file the target writes: [path] is a POSIX path relative to the entry's output root, [contents] its text. */
public data class GeneratedFile(val path: String, val contents: String)

/**
 * The Spring Boot server target (ADR 0022), the one call both build plugins make. It is a pure function of the IR
 * and the entry (ADR 0015 "Generate is pure"): no file system, network, clock or locale. The generated header is the
 * writer's (ADR 0015 "The generated header").
 */
public object SpringBootTarget {
    /** The `use` of a target entry this target generates (ADR 0011 "The app config"). */
    public const val USE: String = "io.github.jubasse:seampact-spring-boot"

    /** The IR kinds and features this target reads: a build plugin reads each api's IR with it (`IrReader.read`). */
    public val IR_SUPPORT: IrSupport = IrSupport.ofModel(kinds = listOf("httpOperation"))

    /**
     * The Java files of one api: its types, the endpoints interfaces, the composed annotations, the results, the
     * exceptions, the boundary's registration and contract table, the copied boundary runtime, and under
     * `frameworkDocs: off` the properties file that turns springdoc's document off, sorted by path.
     *
     * @throws SpringBootRefusedException an option, an entry member or an IR form this release does not serve
     */
    public fun generate(ir: ContractIR, entry: SpringBootEntry): List<GeneratedFile> {
        val options = SpringBootOptions.parse(entry.options)
        val entryRefusals = mutableListOf<SpringBootRefusal>()
        checkEntry(entry, options, entryRefusals)
        if (entryRefusals.isNotEmpty()) throw SpringBootRefusedException(entryRefusals)

        val refusals = Refusals()
        val kept = KeptForms(ir, refusals)
        val layout = JavaLayout(ir, options.packageName, kept, refusals)
        refusals.throwIfAny()

        val types = javaTypes(layout, NativeDocs.of(entry), refusals) + boundaryTypes(layout, options, entry, refusals)
        refusals.throwIfAny()

        val runtime = runtimeFiles(layout, options)

        return (types.map { (packageName, type) -> javaFile(packageName, type, options) } + runtime + frameworkDocsFiles(ir, entry))
            .sortedBy { it.path }
    }

    // `frameworkDocs: off` turns springdoc's own document off in a properties file the app imports (ADR 0022).
    private fun frameworkDocsFiles(ir: ContractIR, entry: SpringBootEntry): List<GeneratedFile> {
        if (entry.frameworkDocs != FRAMEWORK_DOCS_OFF) return emptyList()

        return listOf(GeneratedFile("seampact-${ir.api.id}.properties", "$SPRINGDOC_API_DOCS_ENABLED=false\n"))
    }

    private fun javaTypes(layout: JavaLayout, nativeDocs: NativeDocs, refusals: Refusals): List<Pair<String, TypeSpec>> {
        val mapper = TypeMapper(layout)
        val operationTypes = OperationTypes(layout, mapper, refusals)
        val exceptions = ContractExceptions(layout, mapper)
        val types = mutableListOf<Pair<String, TypeSpec>>()

        types += layout.operationsPackage to redactionType(layout)

        for (enumId in layout.kept.enums) {
            val className = layout.enumClass(enumId) ?: continue
            types += layout.schemasPackage to enumType(className, layout.ir.enums.getValue(enumId), refusals)
        }

        for ((schemaId, schema) in layout.kept.objects) {
            val className = layout.schemaClass(schemaId) ?: continue
            types += layout.schemasPackage to objectRecord(className, schema, mapper, layout, refusals)
        }

        if (layout.kept.errors.isNotEmpty()) types += layout.operationsPackage to exceptions.baseType(layout.kept.errors)
        for (code in layout.kept.errors) {
            exceptions.exceptionType(code)?.let { types += layout.operationsPackage to it }
        }

        for (identityId in layout.kept.identities) {
            authenticateRequestTypes(layout, identityId, refusals).forEach { types += layout.operationsPackage to it }
        }

        for ((index, operation) in layout.kept.operations) {
            val at = IrPlace.ofOperation(index, operation.id)
            operationTypes.inputTypes(operation, at).forEach { types += layout.operationsPackage to it }
            operationTypes.resultTypes(operation).forEach { types += layout.operationsPackage to it }
            composedAnnotation(layout, operation, at, refusals)?.let { types += layout.springPackage to it }
        }

        endpointsTypes(layout, nativeDocs).forEach { types += layout.operationsPackage to it }

        return types
    }

    // The Spring placement of the api's boundary: its contract table, binding, registration and hook interfaces.
    private fun boundaryTypes(layout: JavaLayout, options: SpringBootOptions, entry: SpringBootEntry, refusals: Refusals): List<Pair<String, TypeSpec>> =
        authenticateHookTypes(layout).map { layout.operationsPackage to it } +
            listOf(
                layout.springPackage to contractTableType(layout, options, entry),
                layout.springPackage to bindingType(layout),
                layout.springPackage to configurationType(layout, options.springSecurity),
            ) +
            securityTypes(layout, options.springSecurity, refusals).map { layout.springPackage to it }

    private fun javaFile(packageName: String, type: TypeSpec, options: SpringBootOptions): GeneratedFile {
        val contents = JavaFile.builder(packageName, type)
            .indent(" ".repeat(options.indentSpaces))
            .skipJavaLangImports(true)
            .build()
            .toString()

        return GeneratedFile(packageName.replace('.', '/') + "/" + type.name() + ".java", contents)
    }
}
