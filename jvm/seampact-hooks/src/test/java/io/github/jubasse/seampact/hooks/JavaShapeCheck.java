package io.github.jubasse.seampact.hooks;

import java.io.IOException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.Parameter;
import java.lang.reflect.RecordComponent;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/** Compares the package's classes with the shape manifest by reflection and lists every difference found. */
final class JavaShapeCheck {
    private static final String PACKAGE_NAME = "io.github.jubasse.seampact.hooks";
    private static final String CLASS_SUFFIX = ".class";
    private static final String PACKAGE_INFO = "package-info";

    private final List<String> problems = new ArrayList<>();

    private JavaShapeCheck() {}

    static List<String> check(List<ShapeManifest.Type> types, Optional<Path> classesDirectory) throws IOException {
        JavaShapeCheck check = new JavaShapeCheck();
        Set<String> expectedNames = new TreeSet<>();

        for (ShapeManifest.Type type : types) {
            if (type.existsInJava()) {
                check.checkType(type, expectedNames);
            }
        }

        if (classesDirectory.isPresent()) {
            check.checkNoUnlistedPublicType(classesDirectory.get(), expectedNames);
        }

        return check.problems;
    }

    private void checkType(ShapeManifest.Type type, Set<String> expectedNames) {
        expectedNames.add(type.name());

        Optional<Class<?>> loaded = load(type.name());
        if (loaded.isEmpty()) {
            problems.add(type.name() + ": no public Java type of this name");

            return;
        }

        Class<?> javaType = loaded.get();
        if (!Modifier.isPublic(javaType.getModifiers())) {
            problems.add(type.name() + ": the type is not public");
        }

        switch (type.kind()) {
            case "record" -> checkRecord(type.name(), javaType, type.members());
            case "interface" -> checkInterface(type.name(), javaType, type.members());
            case "hook" -> checkHook(type, javaType);
            case "union" -> checkUnion(type, javaType, expectedNames);
            case "enum" -> checkEnum(type, javaType);
            case "class" -> checkClass(type, javaType);
            default -> problems.add(type.name() + ": the kind \"" + type.kind() + "\" is not known to the Java check");
        }
    }

    private Optional<Class<?>> load(String manifestName) {
        String binaryName = PACKAGE_NAME + "." + manifestName.replace('.', '$');

        try {
            return Optional.of(Class.forName(binaryName, false, JavaShapeCheck.class.getClassLoader()));
        } catch (ClassNotFoundException notFound) {
            return Optional.empty();
        }
    }

    private void checkRecord(String owner, Class<?> javaType, List<ShapeManifest.Member> members) {
        if (!javaType.isRecord()) {
            problems.add(owner + ": expected a record");

            return;
        }

        if (!Modifier.isFinal(javaType.getModifiers())) {
            problems.add(owner + ": a record must be final");
        }

        List<ShapeManifest.Member> javaMembers = members.stream().filter(ShapeManifest.Member::existsInJava).toList();
        RecordComponent[] components = javaType.getRecordComponents();
        compareNames(owner, javaMembers.stream().map(ShapeManifest.Member::name).toList(),
                Arrays.stream(components).map(RecordComponent::getName).toList());

        for (ShapeManifest.Member member : javaMembers) {
            if (member.nullable()) {
                // A record component carries no nullness in its type: the check refuses rather than pass it unseen.
                problems.add(owner + "." + member.name() + ": a nullable record member cannot be checked by reflection");
            }
            Arrays.stream(components)
                    .filter(component -> component.getName().equals(member.name()))
                    .findFirst()
                    .ifPresent(component -> checkMemberType(owner, member, component.getType()));
        }
    }

    private void checkInterface(String owner, Class<?> javaType, List<ShapeManifest.Member> members) {
        if (!javaType.isInterface()) {
            problems.add(owner + ": expected an interface");

            return;
        }

        List<ShapeManifest.Member> javaMembers = members.stream().filter(ShapeManifest.Member::existsInJava).toList();
        List<Method> accessors = Arrays.stream(javaType.getDeclaredMethods())
                .filter(method -> !method.isSynthetic() && !Modifier.isStatic(method.getModifiers()))
                .toList();
        compareNames(owner, javaMembers.stream().map(ShapeManifest.Member::name).toList(),
                accessors.stream().map(Method::getName).toList());

        // Nullness is not in a Java type, so an interface accessor's `nullable` flag is not checked here.
        for (ShapeManifest.Member member : javaMembers) {
            accessors.stream()
                    .filter(method -> method.getName().equals(member.name()))
                    .findFirst()
                    .ifPresent(method -> checkMemberType(owner, member, method.getReturnType()));
        }
    }

    private void checkMemberType(String owner, ShapeManifest.Member member, Class<?> javaMemberType) {
        String where = owner + "." + member.name();
        boolean isOptional = javaMemberType == Optional.class;
        if (member.optional() && !isOptional) {
            problems.add(where + ": an optional member must be Optional<T>");
        }
        if (!member.optional() && isOptional) {
            problems.add(where + ": a required member must not be Optional<T>");
        }

        member.enumName().ifPresent(enumName -> {
            if (!javaMemberType.getSimpleName().equals(enumName)) {
                problems.add(where + ": expected the enum " + enumName + ", found " + javaMemberType.getSimpleName());
            }
        });
    }

    private void checkHook(ShapeManifest.Type type, Class<?> javaType) {
        if (!javaType.isInterface()) {
            problems.add(type.name() + ": expected an interface");

            return;
        }

        List<Method> methods = Arrays.stream(javaType.getDeclaredMethods())
                .filter(method -> !method.isSynthetic() && !Modifier.isStatic(method.getModifiers()))
                .toList();
        compareNames(type.name(), type.methods().stream().map(ShapeManifest.Method::name).toList(),
                methods.stream().map(Method::getName).toList());

        for (ShapeManifest.Method expected : type.methods()) {
            methods.stream()
                    .filter(method -> method.getName().equals(expected.name()))
                    .findFirst()
                    .ifPresent(method -> checkParameters(type.name(), expected, method));
        }
    }

    private void checkParameters(String owner, ShapeManifest.Method expected, Method actual) {
        List<String> names = Arrays.stream(actual.getParameters()).map(Parameter::getName).toList();
        if (!names.equals(expected.parameters())) {
            problems.add(owner + "." + expected.name() + ": parameters " + names + ", expected " + expected.parameters());
        }
    }

    private void checkUnion(ShapeManifest.Type type, Class<?> javaType, Set<String> expectedNames) {
        if (!javaType.isSealed() || !javaType.isInterface()) {
            problems.add(type.name() + ": expected a sealed interface");

            return;
        }

        Set<String> expectedArms = new TreeSet<>();
        for (ShapeManifest.Arm arm : type.arms()) {
            String armName = arm.type().orElseGet(() -> type.name() + "." + arm.name().orElseThrow());
            expectedArms.add(armName);

            if (arm.name().isPresent()) {
                expectedNames.add(armName);
                load(armName).ifPresentOrElse(
                        armClass -> checkArm(armName, armClass, javaType, arm),
                        () -> problems.add(armName + ": no public Java type of this name"));
            }
        }

        Set<String> permitted = Arrays.stream(javaType.getPermittedSubclasses())
                .map(permittedClass -> permittedClass.getName().substring(PACKAGE_NAME.length() + 1).replace('$', '.'))
                .collect(Collectors.toCollection(TreeSet::new));
        if (!permitted.equals(expectedArms)) {
            problems.add(type.name() + ": permits " + permitted + ", expected " + expectedArms);
        }
    }

    private void checkArm(String armName, Class<?> armClass, Class<?> union, ShapeManifest.Arm arm) {
        if (!union.isAssignableFrom(armClass)) {
            problems.add(armName + ": does not implement " + union.getSimpleName());
        }
        checkRecord(armName, armClass, arm.members());
    }

    private void checkEnum(ShapeManifest.Type type, Class<?> javaType) {
        if (!javaType.isEnum()) {
            problems.add(type.name() + ": expected an enum");

            return;
        }

        List<String> constants = Arrays.stream(javaType.getEnumConstants())
                .map(constant -> ((Enum<?>) constant).name().toLowerCase(Locale.ROOT))
                .toList();
        if (!constants.equals(type.values())) {
            problems.add(type.name() + ": values " + constants + ", expected " + type.values());
        }
    }

    private void checkClass(ShapeManifest.Type type, Class<?> javaType) {
        if (!Modifier.isFinal(javaType.getModifiers())) {
            problems.add(type.name() + ": a class must be final");
        }

        List<Method> methods = Arrays.stream(javaType.getDeclaredMethods())
                .filter(method -> Modifier.isPublic(method.getModifiers()) && !method.isSynthetic())
                .filter(method -> !Set.of("equals", "hashCode", "toString").contains(method.getName()))
                .toList();
        compareNames(type.name(), type.methods().stream().map(ShapeManifest.Method::name).toList(),
                methods.stream().map(Method::getName).toList());

        for (ShapeManifest.Method expected : type.methods()) {
            methods.stream()
                    .filter(method -> method.getName().equals(expected.name()))
                    .findFirst()
                    .ifPresent(method -> {
                        if (Modifier.isStatic(method.getModifiers()) != expected.isStatic()) {
                            problems.add(type.name() + "." + expected.name() + ": static is not " + expected.isStatic());
                        }
                        checkParameters(type.name(), expected, method);
                    });
        }
    }

    private void compareNames(String owner, List<String> expected, List<String> actual) {
        for (String name : expected) {
            if (!actual.contains(name)) {
                problems.add(owner + ": missing member " + name);
            }
        }
        for (String name : actual) {
            if (!expected.contains(name)) {
                problems.add(owner + ": member " + name + " is not in the shape manifest");
            }
        }
    }

    private void checkNoUnlistedPublicType(Path classesDirectory, Set<String> expectedNames) throws IOException {
        try (Stream<Path> files = Files.walk(classesDirectory)) {
            List<String> classFiles = files.map(file -> classesDirectory.relativize(file).toString())
                    .filter(file -> file.endsWith(CLASS_SUFFIX))
                    .toList();

            for (String file : classFiles) {
                String binaryName = file.substring(0, file.length() - CLASS_SUFFIX.length()).replace('/', '.');
                if (binaryName.endsWith(PACKAGE_INFO)) {
                    continue;
                }

                String manifestName = binaryName.substring(PACKAGE_NAME.length() + 1).replace('$', '.');
                if (isPublic(binaryName) && !expectedNames.contains(manifestName)) {
                    problems.add(manifestName + ": a public Java type that is not in the shape manifest");
                }
            }
        }
    }

    private boolean isPublic(String binaryName) {
        try {
            return Modifier.isPublic(Class.forName(binaryName, false, JavaShapeCheck.class.getClassLoader()).getModifiers());
        } catch (ClassNotFoundException notFound) {
            throw new IllegalStateException("The compiled class " + binaryName + " cannot be loaded.", notFound);
        }
    }
}
