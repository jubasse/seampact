package io.github.jubasse.seampact.hooks;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class HooksShapeTest {
    private static final String REPOSITORY_ROOT_PROPERTY = "seampact.repositoryRoot";
    private static final String CLASSES_DIRECTORY_PROPERTY = "seampact.hooksClassesDirectory";
    private static final String MANIFEST_PATH = "fixtures/hooks-shape/shape.json";

    private static List<ShapeManifest.Type> manifest() throws IOException {
        return ShapeManifest.read(Path.of(System.getProperty(REPOSITORY_ROOT_PROPERTY)).resolve(MANIFEST_PATH));
    }

    private static Optional<Path> classesDirectory() {
        return Optional.of(Path.of(System.getProperty(CLASSES_DIRECTORY_PROPERTY)));
    }

    @Test
    void matchesShapeManifest() throws IOException {
        assertEquals(List.of(), JavaShapeCheck.check(manifest(), classesDirectory()));
    }

    @Test
    void namesAMissingMember() throws IOException {
        List<ShapeManifest.Type> drifted = new ArrayList<>();
        for (ShapeManifest.Type type : manifest()) {
            drifted.add(type.name().equals("RequestView") ? withExtraMember(type) : type);
        }

        List<String> problems = JavaShapeCheck.check(drifted, classesDirectory());

        assertTrue(problems.contains("RequestView: missing member cookies"), problems::toString);
    }

    @Test
    void namesAnUnlistedPublicType() throws IOException {
        List<ShapeManifest.Type> withoutDecision =
                manifest().stream().filter(type -> !type.name().equals("ThrottleBucket")).toList();

        List<String> problems = JavaShapeCheck.check(withoutDecision, classesDirectory());

        assertTrue(
                problems.contains("ThrottleBucket: a public Java type that is not in the shape manifest"),
                problems::toString);
    }

    private static ShapeManifest.Type withExtraMember(ShapeManifest.Type type) {
        List<ShapeManifest.Member> members = new ArrayList<>(type.members());
        members.add(new ShapeManifest.Member("cookies", false, false, Optional.empty(), List.of()));

        return new ShapeManifest.Type(
                type.name(), type.kind(), type.languages(), type.discriminant(), members, type.arms(),
                type.methods(), type.values());
    }
}
