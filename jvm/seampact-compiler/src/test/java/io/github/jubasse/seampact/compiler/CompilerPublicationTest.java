package io.github.jubasse.seampact.compiler;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.jubasse.seampact.ir.binary.BinaryPlatform;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import org.gradle.testkit.runner.BuildResult;
import org.gradle.testkit.runner.GradleRunner;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

// Publishing stub binaries to a file repository writes one `exe` artefact per platform classifier of seampact-ir's
// `BinaryPlatform`, each with the hash `SHA256SUMS` lists; a binary that differs from the manifest is never published.
class CompilerPublicationTest {
    private static final String VERSION = "0.0.0-test";
    private static final Path PUBLICATION_SCRIPT = Path.of(System.getProperty("seampact.publicationScript"));

    @TempDir
    Path work;

    @Test
    void publishesOneClassifierArtefactPerPlatformWithTheManifestHash() throws IOException, NoSuchAlgorithmException {
        Path binaries = writeStubBinaries();
        Path repository = work.resolve("repository");

        publish(binaries, repository).build();

        Path published = repository.resolve("io/github/jubasse/seampact-compiler/" + VERSION);
        for (BinaryPlatform platform : BinaryPlatform.getEntries()) {
            Path artefact = published.resolve("seampact-compiler-" + VERSION + "-" + platform.getClassifier() + ".exe");
            assertTrue(Files.isRegularFile(artefact), "missing " + artefact);
            assertEquals(manifestHash(binaries, platform.getAssetName()), sha256(artefact), platform.getClassifier());
        }
        assertTrue(Files.isRegularFile(published.resolve("seampact-compiler-" + VERSION + ".pom")));
    }

    @Test
    void refusesABinaryThatDiffersFromTheManifest() throws IOException, NoSuchAlgorithmException {
        Path binaries = writeStubBinaries();
        Files.writeString(binaries.resolve("seampact-darwin-arm64"), "tampered");

        BuildResult result = publish(binaries, work.resolve("repository")).buildAndFail();

        assertTrue(result.getOutput().contains("seampact-darwin-arm64' has the SHA-256"), result.getOutput());
        assertTrue(Files.notExists(work.resolve("repository/io/github/jubasse/seampact-compiler")));
    }

    private GradleRunner publish(Path binaries, Path repository) throws IOException {
        Path project = work.resolve("project");
        Files.createDirectories(project);
        Files.writeString(project.resolve("settings.gradle.kts"), "rootProject.name = \"seampact-compiler\"\n");
        Files.writeString(
                project.resolve("build.gradle.kts"),
                "group = \"io.github.jubasse\"\napply(from = \"" + escaped(PUBLICATION_SCRIPT) + "\")\n");

        return GradleRunner.create()
                .withProjectDir(project.toFile())
                .withArguments(
                        "publishToMavenLocal",
                        "-PseampactBinariesDir=" + binaries,
                        "-PseampactCompilerVersion=" + VERSION,
                        "-Dmaven.repo.local=" + repository,
                        "--stacktrace");
    }

    // Five distinct stub binaries and their manifest, as `scripts/manifest.mjs` writes it.
    private Path writeStubBinaries() throws IOException, NoSuchAlgorithmException {
        Path binaries = work.resolve("binaries");
        Files.createDirectories(binaries);
        List<String> lines = new ArrayList<>();
        for (BinaryPlatform platform : BinaryPlatform.getEntries()) {
            Path binary = binaries.resolve(platform.getAssetName());
            Files.writeString(binary, "stub binary for " + platform.getClassifier());
            lines.add(sha256(binary) + "  " + platform.getAssetName());
        }
        Files.writeString(binaries.resolve(BinaryPlatform.MANIFEST_FILE_NAME), String.join("\n", lines) + "\n");

        return binaries;
    }

    private static String manifestHash(Path binaries, String assetName) throws IOException {
        for (String line : Files.readAllLines(binaries.resolve(BinaryPlatform.MANIFEST_FILE_NAME), StandardCharsets.UTF_8)) {
            if (line.endsWith("  " + assetName)) return line.substring(0, line.indexOf("  "));
        }

        throw new AssertionError("SHA256SUMS lists no " + assetName);
    }

    private static String sha256(Path file) throws IOException, NoSuchAlgorithmException {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(file)));
    }

    // A path inside a Kotlin string literal.
    private static String escaped(Path path) {
        return path.toString().replace("\\", "\\\\").replace("$", "\\$");
    }
}
