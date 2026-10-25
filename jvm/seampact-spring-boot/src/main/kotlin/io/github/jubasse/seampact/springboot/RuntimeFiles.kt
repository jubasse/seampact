package io.github.jubasse.seampact.springboot

/** The package the runtime sources are written in, replaced by the api's `<package>.spring.runtime` when copied. */
private const val RUNTIME_SOURCE_PACKAGE = "io.github.jubasse.seampact.springboot.runtime"

private const val RUNTIME_RESOURCE_DIRECTORY = "seampact-spring-runtime"

// The boundary runtime's classes, copied into every api's output (ADR 0015 "Runtime helpers").
private val RUNTIME_CLASSES = listOf(
    "AccessSteps", "ApiBinding", "BodyReader", "BootCheck", "BoundaryExchange", "BoundaryFilter", "BoundaryInterceptor",
    "BoundaryMapper", "BoundaryMvcConfigurer", "CacheHeaders", "CheckingResponse", "ContractExceptionResolver", "ContractInputResolver",
    "ContractRefusal", "ContractReplyHandler", "ContractRoute", "ContractTable", "Decider", "Denial", "Digests", "ErrorReplies",
    "HeldBodyRequest", "IdempotencyStep", "InputFieldRights", "InputIssue", "InputStep", "OutgoingCheck", "OutputFieldRights", "PageReply", "ReplyHandlerFirst",
    "RequirementCall", "ScalarValues", "ScopeCall", "ScopeResolver", "SeampactBoundary", "SignatureHeader", "StructuralValidator", "Templates",
    "UnexpectedErrorListener", "WireDecoding",
)

/** The boundary runtime's sources, moved into [runtimePackage]. */
internal fun runtimeFiles(runtimePackage: String): List<GeneratedFile> = RUNTIME_CLASSES.map { name ->
    val resource = "/$RUNTIME_RESOURCE_DIRECTORY/$name.java"
    val source = SpringBootTarget::class.java.getResourceAsStream(resource)?.use { it.readBytes().decodeToString() }
        ?: error("seampact-spring-boot: the runtime source $resource is missing from the target's jar")

    GeneratedFile(
        runtimePackage.replace('.', '/') + "/$name.java",
        source.replace("package $RUNTIME_SOURCE_PACKAGE;", "package $runtimePackage;"),
    )
}
