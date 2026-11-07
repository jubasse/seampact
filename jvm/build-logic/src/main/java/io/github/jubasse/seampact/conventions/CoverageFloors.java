package io.github.jubasse.seampact.conventions;

import groovy.json.JsonSlurper;
import org.gradle.api.GradleException;
import org.gradle.api.Project;
import org.gradle.api.artifacts.VersionCatalogsExtension;
import org.gradle.api.file.RegularFile;
import org.gradle.api.tasks.testing.Test;
import org.gradle.testing.jacoco.plugins.JacocoPlugin;
import org.gradle.testing.jacoco.plugins.JacocoPluginExtension;
import org.gradle.testing.jacoco.tasks.JacocoCoverageVerification;
import org.gradle.testing.jacoco.tasks.JacocoReport;
import org.gradle.testing.jacoco.tasks.rules.JacocoViolationRule;

import java.math.BigDecimal;
import java.util.Map;

/**
 * The coverage of a module's own tests, measured only when the build runs with {@code -PseampactCoverage}: JaCoCo
 * writes the XML and HTML reports after {@code test}, and {@code check} fails when the module's line or branch ratio
 * falls under its floor in {@code scripts/coverage-floors/floors.json}, keyed {@code jvm/<module>}. A module the file lists
 * under {@code notMeasured} runs without JaCoCo; a module in neither list fails the build, so none is skipped silently.
 */
final class CoverageFloors {
    private static final String COVERAGE_PROPERTY = "seampactCoverage";
    // From the root of the JVM build.
    private static final String FLOORS_PATH = "../scripts/coverage-floors/floors.json";
    private static final String PACKAGE_PREFIX = "jvm/";
    private static final String FLOORS_KEY = "packages";
    private static final String NOT_MEASURED_KEY = "notMeasured";
    private static final String LINES_KEY = "lines";
    private static final String BRANCHES_KEY = "branches";

    private static final String CATALOG = "libs";
    private static final String JACOCO_VERSION_ALIAS = "jacoco";
    private static final String TEST_TASK = "test";
    private static final String REPORT_TASK = "jacocoTestReport";
    private static final String VERIFICATION_TASK = "jacocoTestCoverageVerification";
    private static final String CHECK_TASK = "check";
    private static final String LINE_COUNTER = "LINE";
    private static final String BRANCH_COUNTER = "BRANCH";
    private static final String COVERED_RATIO = "COVEREDRATIO";
    private static final int PERCENT_SCALE = 2;

    private CoverageFloors() {
    }

    static void configure(Project project) {
        if (!project.getProviders().gradleProperty(COVERAGE_PROPERTY).isPresent()) return;

        String packageKey = PACKAGE_PREFIX + project.getName();
        Map<?, ?> floorsFile = readFloorsFile(project);
        if (asMap(floorsFile.get(NOT_MEASURED_KEY), NOT_MEASURED_KEY).containsKey(packageKey)) return;

        Object floors = asMap(floorsFile.get(FLOORS_KEY), FLOORS_KEY).get(packageKey);
        if (floors == null) {
            throw new GradleException(packageKey + " has no coverage floor: add it under `" + FLOORS_KEY + "` of "
                + FLOORS_PATH + " at its measured value minus 1 point, or under `" + NOT_MEASURED_KEY + "` with the reason.");
        }

        applyJacoco(project);
        verifyFloors(project, asMap(floors, packageKey));
    }

    private static Map<?, ?> readFloorsFile(Project project) {
        RegularFile floorsFile = project.getRootProject().getLayout().getProjectDirectory().file(FLOORS_PATH);
        String floorsText = project.getProviders().fileContents(floorsFile).getAsText().getOrNull();
        if (floorsText == null) {
            throw new GradleException(floorsFile.getAsFile() + " is missing; -P" + COVERAGE_PROPERTY + " reads the floors from it.");
        }

        return asMap(new JsonSlurper().parseText(floorsText), floorsFile.getAsFile().toString());
    }

    private static Map<?, ?> asMap(Object value, String name) {
        if (value instanceof Map<?, ?> map) return map;

        throw new GradleException(name + " in " + FLOORS_PATH + " is not a JSON object.");
    }

    private static void applyJacoco(Project project) {
        project.getPluginManager().apply(JacocoPlugin.class);
        String jacocoVersion = project.getExtensions().getByType(VersionCatalogsExtension.class).named(CATALOG)
            .findVersion(JACOCO_VERSION_ALIAS)
            .orElseThrow(() -> new GradleException("The version catalog has no `" + JACOCO_VERSION_ALIAS + "` version."))
            .getRequiredVersion();
        project.getExtensions().getByType(JacocoPluginExtension.class).setToolVersion(jacocoVersion);

        project.getTasks().named(REPORT_TASK, JacocoReport.class, report -> {
            report.getReports().getXml().getRequired().set(true);
            report.getReports().getHtml().getRequired().set(true);
        });
        project.getTasks().named(TEST_TASK, Test.class, test -> test.finalizedBy(REPORT_TASK));
    }

    private static void verifyFloors(Project project, Map<?, ?> floors) {
        project.getTasks().named(VERIFICATION_TASK, JacocoCoverageVerification.class, verification ->
            verification.getViolationRules().rule(rule -> {
                addLimit(rule, LINE_COUNTER, floors, LINES_KEY, project.getName());
                // A tool without branch counts has no branch floor; JaCoCo has them, so the floor file states both.
                addLimit(rule, BRANCH_COUNTER, floors, BRANCHES_KEY, project.getName());
            }));
        project.getTasks().named(CHECK_TASK, check -> check.dependsOn(VERIFICATION_TASK));
    }

    private static void addLimit(JacocoViolationRule rule, String counter, Map<?, ?> floors, String floorKey, String moduleName) {
        if (!(floors.get(floorKey) instanceof Number percent)) {
            throw new GradleException(PACKAGE_PREFIX + moduleName + " has no numeric `" + floorKey + "` floor in " + FLOORS_PATH + ".");
        }

        rule.limit(limit -> {
            limit.setCounter(counter);
            limit.setValue(COVERED_RATIO);
            limit.setMinimum(new BigDecimal(percent.toString()).movePointLeft(PERCENT_SCALE));
        });
    }
}
