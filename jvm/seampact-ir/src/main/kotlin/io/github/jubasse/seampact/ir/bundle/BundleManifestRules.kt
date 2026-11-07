package io.github.jubasse.seampact.ir.bundle

// The manifest rules no JSON Schema states (`schemas/bundle/README.md`, "Manifest rules"), checked after the schema:
// files strictly sorted by path in code-unit order, so no path is listed twice; no two paths equal once folded to
// ASCII lower case; each api named once, its file `ir/<name>.json` and listed; every `ir/` file an api's; packs
// sorted by name then version, none twice. Each problem reads `at '<pointer>' <problem>`.

/** Every rule a schema-valid manifest breaks, in manifest order. */
internal fun bundleManifestRuleProblems(manifest: BundleManifest): List<String> =
    fileProblems(manifest) + apiProblems(manifest) + packProblems(manifest)

private fun at(pointer: String, message: String): String = "at ${quoted(pointer)} $message"

private fun fileProblems(manifest: BundleManifest): List<String> {
    val problems = mutableListOf<String>()
    val pathByFold = HashMap<String, String>()

    manifest.files.forEachIndexed { index, file ->
        val pointer = "/files/$index/path"
        val previous = manifest.files.getOrNull(index - 1)?.path

        if (previous == file.path) {
            problems += at(pointer, "'${file.path}' is listed twice")
        } else if (previous != null && compareBundlePaths(previous, file.path) > 0) {
            problems += at(pointer, "'${file.path}' is listed after '$previous'; sort the files by path")
        }

        val folded = bundlePathFold(file.path)
        val sameFold = pathByFold[folded]
        if (sameFold != null && sameFold != file.path) {
            problems += at(pointer, "'${file.path}' differs from '$sameFold' only in letter case")
        }
        pathByFold[folded] = file.path
    }

    return problems
}

private fun apiProblems(manifest: BundleManifest): List<String> {
    val problems = mutableListOf<String>()
    val listed = manifest.files.map { it.path }.toSet()
    val apiFiles = HashSet<String>()
    val names = HashSet<String>()

    manifest.apis.forEachIndexed { index, api ->
        val expectedFile = "$BUNDLE_IR_DIRECTORY/${api.name}.json"

        if (api.name in names) problems += at("/apis/$index/name", "the api '${api.name}' is listed twice")

        if (api.file != expectedFile) {
            problems += at("/apis/$index/file", "the file of api '${api.name}' is '${api.file}', not '$expectedFile'")
        } else if (api.file !in listed) {
            problems += at("/apis/$index/file", "'${api.file}' is not in files")
        }

        names += api.name
        apiFiles += api.file
    }

    manifest.files.forEachIndexed { index, file ->
        if (file.path.startsWith("$BUNDLE_IR_DIRECTORY/") && file.path !in apiFiles) {
            problems += at("/files/$index/path", "'${file.path}' is not the file of any api")
        }
    }

    return problems
}

private fun packProblems(manifest: BundleManifest): List<String> {
    val problems = mutableListOf<String>()

    manifest.packs.forEachIndexed { index, pack ->
        val previous = manifest.packs.getOrNull(index - 1) ?: return@forEachIndexed
        val nameOrder = compareBundlePaths(previous.name, pack.name)
        val order = if (nameOrder != 0) nameOrder else compareBundlePaths(previous.version, pack.version)

        if (order >= 0) {
            problems += at(
                "/packs/$index",
                "the pack '${pack.name}@${pack.version}' is listed twice or out of order; sort the packs by name then version",
            )
        }
    }

    return problems
}
