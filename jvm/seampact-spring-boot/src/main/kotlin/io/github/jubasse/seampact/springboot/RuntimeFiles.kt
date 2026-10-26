package io.github.jubasse.seampact.springboot

/** The package the runtime sources are written in, replaced by the api's `<package>.spring.runtime` when copied. */
private const val RUNTIME_SOURCE_PACKAGE = "io.github.jubasse.seampact.springboot.runtime"

private const val RUNTIME_RESOURCE_DIRECTORY = "seampact-spring-runtime"

// The boundary runtime's classes, copied into every api's output (ADR 0015 "Runtime helpers").
private val RUNTIME_CLASSES = listOf(
    "AccessSteps", "ApiBinding", "BodyReader", "BootCheck", "BoundaryExchange", "BoundaryFilter", "BoundaryInterceptor",
    "BoundaryMapper", "BoundaryMvcConfigurer", "CacheHeaders", "CheckingResponse", "ContractExceptionResolver", "ContractInputResolver",
    "ContractRefusal", "ContractReplyHandler", "ContractRoute", "ContractTable", "Decider", "Denial", "Digests", "ErrorReplies",
    "HeldBodyRequest", "IdempotencyStep", "InputFieldRights", "InputIssue", "InputStep", "OutgoingCheck", "OutputFieldRights", "PageReply", "PublicOrigin", "ReplyHandlerFirst",
    "RequirementCall", "ScalarValues", "ScopeCall", "ScopeResolver", "SeampactBoundary", "SignatureHeader", "StructuralValidator", "SuccessEnvelope", "Templates",
    "UnexpectedErrorListener", "WireDecoding",
)

/** The runtime class that builds Spring Data's `Pageable` and reads its `Page`, copied only for a `springPage` list. */
internal const val SPRING_DATA_PAGES = "SpringDataPages"

/**
 * The boundary runtime's sources, moved into the api's runtime package; the Spring Data bridge and the Spring Security
 * refusals only when they are used.
 */
internal fun runtimeFiles(layout: JavaLayout, options: SpringBootOptions): List<GeneratedFile> {
    val classes = RUNTIME_CLASSES +
        listOfNotNull(
            SPRING_DATA_PAGES.takeIf { usesSpringPages(layout) },
            SECURITY_REFUSALS.takeIf { options.springSecurity != SpringSecurityMode.OFF },
        )

    return classes.map { name -> runtimeFile(layout.runtimePackage, name) }
}

private fun runtimeFile(runtimePackage: String, name: String): GeneratedFile {
    val resource = "/$RUNTIME_RESOURCE_DIRECTORY/$name.java"
    val source = SpringBootTarget::class.java.getResourceAsStream(resource)?.use { it.readBytes().decodeToString() }
        ?: error("seampact-spring-boot: the runtime source $resource is missing from the target's jar")

    return GeneratedFile(
        runtimePackage.replace('.', '/') + "/$name.java",
        source.replace("package $RUNTIME_SOURCE_PACKAGE;", "package $runtimePackage;"),
    )
}
