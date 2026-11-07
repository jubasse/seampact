package io.github.jubasse.seampact.maven

import io.github.jubasse.seampact.ir.config.LocalSourcePolicy
import io.github.jubasse.seampact.runner.fixtures.ReferenceApp
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.TimeUnit
import kotlin.io.path.copyTo
import kotlin.io.path.readText

/**
 * A throwaway Spring Boot app built by a real Maven, through the consumer's `mvnw` on the Maven release under test:
 * the reference contract as a `path` source compiled by the stub binary. The seampact modules come from the root
 * build's file repository, everything else from Maven Central into a local repository the tests share under
 * `build/`, so a run after the first can be offline.
 */
internal class MavenApp(val directory: Path) {
    val stubBinary: Path = directory.resolve("stub-seampact")
    val stubMarker: Path = directory.resolve("stub-ran")

    init {
        ReferenceApp.copyContract(directory)
        ReferenceApp.writeStubBinary(stubBinary, stubMarker)
        installWrapper()
        writeSettings()
    }

    /**
     * Writes the POM, with [configuration] as the seampact plugin's `<configuration>` content, [repositories] as
     * the project's `<repositories>` content and [runtimeVersion] as the version of the seampact-spring-runtime
     * dependency, none when null.
     */
    fun writePom(configuration: String, repositories: String = "", runtimeVersion: String? = PLUGIN_VERSION) {
        val runtimeDependency = runtimeVersion?.let {
            "<dependency><groupId>io.github.jubasse</groupId><artifactId>seampact-spring-runtime</artifactId><version>$it</version></dependency>"
        } ?: ""

        write(
            "pom.xml",
            """
            <project xmlns="http://maven.apache.org/POM/4.0.0">
              <modelVersion>4.0.0</modelVersion>
              <parent>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-starter-parent</artifactId>
                <version>${System.getProperty("seampact.springBootVersion")}</version>
                <relativePath/>
              </parent>
              <groupId>com.example</groupId>
              <artifactId>sample-app</artifactId>
              <version>0.0.0</version>
              <properties>
                <java.version>21</java.version>
              </properties>
              <repositories>
            $repositories
              </repositories>
              <dependencies>
                <dependency>
                  <groupId>org.springframework.boot</groupId>
                  <artifactId>spring-boot-starter-webmvc</artifactId>
                </dependency>
                <dependency>
                  <groupId>org.springframework.boot</groupId>
                  <artifactId>spring-boot-starter-validation</artifactId>
                </dependency>
                <dependency>
                  <groupId>io.github.jubasse</groupId>
                  <artifactId>seampact-hooks</artifactId>
                  <version>$PLUGIN_VERSION</version>
                </dependency>
                $runtimeDependency
              </dependencies>
              <build>
                <plugins>
                  <plugin>
                    <groupId>io.github.jubasse</groupId>
                    <artifactId>seampact-maven-plugin</artifactId>
                    <version>$PLUGIN_VERSION</version>
                    <executions>
                      <execution>
                        <goals>
                          <goal>generate</goal>
                          <goal>check</goal>
                        </goals>
                      </execution>
                    </executions>
                    <configuration>
            $configuration
                    </configuration>
                  </plugin>
                </plugins>
              </build>
            </project>
            """,
        )
    }

    /** The `<binary>` element that pins the stub binary by its hash. */
    fun stubBinaryElement(): String =
        "<binary><path>stub-seampact</path><sha256>${ReferenceApp.sha256Of(stubBinary)}</sha256></binary>"

    fun write(relativePath: String, text: String) {
        ReferenceApp.writeFile(directory, relativePath, text)
    }

    /** Runs `mvnw` with [arguments]; the build's exit code and its output. */
    fun run(vararg arguments: String, extraEnvironment: Map<String, String> = emptyMap()): MavenRun {
        val log = directory.resolve("maven-${runCount++}.log")
        val command = listOf("./mvnw", "-B", "-s", "settings.xml", "-Dstyle.color=never") + arguments
        val process = ProcessBuilder(command)
            .directory(directory.toFile())
            .redirectErrorStream(true)
            .redirectOutput(log.toFile())
            .apply {
                val variables = environment()
                variables.remove(LocalSourcePolicy.ALLOW_LOCAL_VARIABLE)
                variables["JAVA_HOME"] = System.getProperty("java.home")
                variables["MAVEN_USER_HOME"] = workDirectory.resolve("maven-user-home").toString()
                variables["MAVEN_OPTS"] = "-Duser.home=${workDirectory.resolve("user-home")}"
                variables.putAll(extraEnvironment)
            }
            .start()
        if (!process.waitFor(RUN_TIMEOUT_MINUTES, TimeUnit.MINUTES)) {
            process.destroyForcibly()
            error("mvnw ${arguments.joinToString(" ")} did not finish within $RUN_TIMEOUT_MINUTES minutes; see $log.")
        }
        val output = log.readText()
        print(output)

        return MavenRun(process.exitValue(), output)
    }

    private var runCount = 0

    // The consumer's own wrapper script, on the Maven release under test, checked against its pinned SHA-256.
    private fun installWrapper() {
        val consumerRoot = ReferenceApp.repositoryRoot.resolve("scripts/consumers/targets/spring-boot/maven")
        consumerRoot.resolve("mvnw").copyTo(directory.resolve("mvnw"))
        directory.resolve("mvnw").toFile().setExecutable(true)
        val version = System.getProperty("seampact.testMaven")
        write(
            ".mvn/wrapper/maven-wrapper.properties",
            """
            distributionType=only-script
            distributionUrl=https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/$version/apache-maven-$version-bin.zip
            distributionSha256Sum=${System.getProperty("seampact.testMavenSha256")}
            """,
        )
    }

    // The shared local repository, and the file repository of the seampact modules for plugins and dependencies.
    private fun writeSettings() {
        val testRepository = Path.of(System.getProperty("seampact.testRepository")).toUri()
        write(
            "settings.xml",
            """
            <settings>
              <localRepository>${localRepository}</localRepository>
              <profiles>
                <profile>
                  <id>seampact</id>
                  <repositories>
                    <repository><id>seampact-test</id><url>$testRepository</url></repository>
                  </repositories>
                  <pluginRepositories>
                    <pluginRepository><id>seampact-test</id><url>$testRepository</url></pluginRepository>
                  </pluginRepositories>
                </profile>
              </profiles>
              <activeProfiles><activeProfile>seampact</activeProfile></activeProfiles>
            </settings>
            """,
        )
    }

    companion object {
        private const val RUN_TIMEOUT_MINUTES = 15L
        val PLUGIN_VERSION: String = System.getProperty("seampact.pluginVersion")

        private val workDirectory: Path = Path.of(System.getProperty("seampact.testWorkDirectory"))

        // The seampact modules are released versions to Maven, never checked again once in the local repository: the
        // copies of an earlier test run are removed once per test JVM, so each run takes this build's jars.
        private val localRepository: Path by lazy {
            val repository = workDirectory.resolve("repository")
            repository.resolve("io/github/jubasse").toFile().deleteRecursively()
            repository
        }
    }
}

/** One Maven run: its exit code and output. */
internal data class MavenRun(val exitCode: Int, val output: String) {
    val succeeded: Boolean get() = exitCode == 0
}

/** Every file under [root], by its `/`-separated path relative to [root], with its text. */
internal fun treeOf(root: Path): Map<String, String> = Files.walk(root).use { paths ->
    paths.filter(Files::isRegularFile).toList().associate { root.relativize(it).joinToString("/") to it.readText() }
}
