package io.github.jubasse.seampact.hooks;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import kotlinx.serialization.json.Json;
import kotlinx.serialization.json.JsonElement;
import kotlinx.serialization.json.JsonElementKt;
import kotlinx.serialization.json.JsonPrimitive;

/** The shape manifest every hooks package shares, read from {@code fixtures/hooks-shape/shape.json}. */
final class ShapeManifest {
    private static final String JAVA_LANGUAGE = "java";

    record Discriminant(String member, String value) {}

    record Member(
            String name, boolean optional, boolean nullable, Optional<String> enumName, List<String> languages) {
        boolean existsInJava() {
            return ShapeManifest.languagesIncludeJava(languages);
        }
    }

    record Arm(
            Optional<String> name,
            Optional<String> type,
            Optional<Discriminant> discriminant,
            List<Member> members) {}

    record Method(String name, List<String> parameters, boolean isStatic, Optional<String> returns) {}

    record Type(
            String name,
            String kind,
            List<String> languages,
            Optional<Discriminant> discriminant,
            List<Member> members,
            List<Arm> arms,
            List<Method> methods,
            List<String> values) {
        boolean existsInJava() {
            return ShapeManifest.languagesIncludeJava(languages);
        }
    }

    private ShapeManifest() {}

    static boolean languagesIncludeJava(List<String> languages) {
        return languages.isEmpty() || languages.contains(JAVA_LANGUAGE);
    }

    static List<Type> read(Path path) throws IOException {
        JsonElement root = Json.Default.parseToJsonElement(Files.readString(path));

        return array(JsonElementKt.getJsonObject(root), "types").stream().map(entry -> readType(JsonElementKt.getJsonObject(entry))).toList();
    }

    private static Type readType(Map<String, JsonElement> object) {
        return new Type(
                text(object, "name"),
                text(object, "kind"),
                strings(object, "languages"),
                discriminant(object),
                members(object),
                arms(object),
                methods(object),
                strings(object, "values"));
    }

    private static List<Member> members(Map<String, JsonElement> object) {
        return array(object, "members").stream().map(entry -> readMember(JsonElementKt.getJsonObject(entry))).toList();
    }

    private static Member readMember(Map<String, JsonElement> object) {
        return new Member(
                text(object, "name"),
                flag(object, "optional"),
                flag(object, "nullable"),
                Optional.ofNullable(object.get("enum")).map(ShapeManifest::content),
                strings(object, "languages"));
    }

    private static List<Arm> arms(Map<String, JsonElement> object) {
        return array(object, "arms").stream().map(entry -> readArm(JsonElementKt.getJsonObject(entry))).toList();
    }

    private static Arm readArm(Map<String, JsonElement> object) {
        return new Arm(
                Optional.ofNullable(object.get("name")).map(ShapeManifest::content),
                Optional.ofNullable(object.get("type")).map(ShapeManifest::content),
                discriminant(object),
                members(object));
    }

    private static List<Method> methods(Map<String, JsonElement> object) {
        return array(object, "methods").stream()
                .map(entry -> {
                    Map<String, JsonElement> method = JsonElementKt.getJsonObject(entry);

                    return new Method(
                            text(method, "name"),
                            strings(method, "parameters"),
                            flag(method, "static"),
                            Optional.ofNullable(method.get("returns")).map(ShapeManifest::content));
                })
                .toList();
    }

    private static Optional<Discriminant> discriminant(Map<String, JsonElement> object) {
        return Optional.ofNullable(object.get("discriminant")).map(element -> {
            Map<String, JsonElement> discriminant = JsonElementKt.getJsonObject(element);

            return new Discriminant(text(discriminant, "member"), text(discriminant, "value"));
        });
    }

    private static List<JsonElement> array(Map<String, JsonElement> object, String key) {
        JsonElement element = object.get(key);

        return element == null ? List.of() : JsonElementKt.getJsonArray(element);
    }

    private static List<String> strings(Map<String, JsonElement> object, String key) {
        return array(object, key).stream().map(ShapeManifest::content).toList();
    }

    private static String text(Map<String, JsonElement> object, String key) {
        JsonElement element = object.get(key);
        if (element == null) {
            throw new IllegalStateException("The shape manifest entry has no \"" + key + "\": " + object);
        }

        return content(element);
    }

    private static boolean flag(Map<String, JsonElement> object, String key) {
        JsonElement element = object.get(key);

        if (element == null) {
            return false;
        }

        String text = content(element);
        if (!text.equals("true") && !text.equals("false")) {
            throw new IllegalStateException(
                    "The shape manifest entry \"" + key + "\" must be true or false, found \"" + text + "\": " + object);
        }

        return Boolean.parseBoolean(text);
    }

    private static String content(JsonElement element) {
        JsonPrimitive primitive = JsonElementKt.getJsonPrimitive(element);

        return primitive.getContent();
    }
}
