<?php

declare(strict_types=1);

namespace Seampact\Hooks\Tests\Shape;

/**
 * Compares the package's types with the shape manifest by reflection and lists every difference found. A record is
 * a final readonly class whose promoted constructor parameters are its members: an optional member defaults to null,
 * a nullable one allows null without a default. A union is an interface that only its arms implement. A type marked
 * `@internal` is outside the shape.
 */
final class PhpShapeCheck
{
    private const NAMESPACE_PREFIX = 'Seampact\\Hooks\\';
    private const NESTED_TYPE_SEPARATOR = '.';
    private const INTERNAL_TAG = '@internal';
    private const MAGIC_METHOD_PREFIX = '__';

    /** @var list<string> */
    private array $problems = [];

    /** @param list<class-string> $packageTypes */
    private function __construct(private readonly array $packageTypes)
    {
    }

    /**
     * @param list<ManifestType> $types
     *
     * @return list<string>
     */
    public static function check(array $types, string $sourceDirectory): array
    {
        $check = new self(self::packageTypes($sourceDirectory));
        $expectedNames = [];

        foreach ($types as $type) {
            if ($type->existsInPhp()) {
                $expectedNames = [...$expectedNames, ...$check->checkType($type)];
            }
        }

        $check->checkNoUnlistedType($expectedNames);

        return $check->problems;
    }

    /** @return list<class-string> every class, interface and enum the source directory declares */
    private static function packageTypes(string $sourceDirectory): array
    {
        $files = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($sourceDirectory, \FilesystemIterator::SKIP_DOTS));
        $types = [];

        foreach ($files as $file) {
            if (!$file instanceof \SplFileInfo || $file->getExtension() !== 'php') {
                continue;
            }

            $relativePath = substr($file->getPathname(), strlen($sourceDirectory) + 1, -strlen('.php'));
            $typeName = self::NAMESPACE_PREFIX . str_replace('/', '\\', $relativePath);

            if (!class_exists($typeName) && !interface_exists($typeName) && !enum_exists($typeName)) {
                throw new \RuntimeException("The file {$file->getPathname()} does not declare {$typeName}.");
            }

            $types[] = $typeName;
        }

        sort($types);

        return $types;
    }

    /** @return list<string> the manifest names this type stands for */
    private function checkType(ManifestType $type): array
    {
        $reflection = $this->load($type->name);

        if ($reflection === null) {
            $this->problems[] = "{$type->name}: no PHP type of this name";

            return [$type->name];
        }

        match ($type->kind) {
            'record' => $this->checkRecord($type->name, $reflection, $type->members),
            'interface' => $this->checkInterface($type->name, $reflection, $type->members),
            'hook' => $this->checkHook($type, $reflection),
            'union' => $this->checkUnion($type, $reflection),
            'enum' => $this->checkEnum($type, $reflection),
            'class' => $this->checkClass($type, $reflection),
            default => $this->problems[] = "{$type->name}: the kind \"{$type->kind}\" is not known to the PHP check",
        };

        $armNames = array_map(
            static fn (ManifestArm $arm): string => $type->name . self::NESTED_TYPE_SEPARATOR . $arm->name,
            array_values(array_filter($type->arms, static fn (ManifestArm $arm): bool => $arm->name !== null)),
        );

        return [$type->name, ...$armNames];
    }

    private static function typeName(string $manifestName): string
    {
        return self::NAMESPACE_PREFIX . str_replace(self::NESTED_TYPE_SEPARATOR, '\\', $manifestName);
    }

    /** @return \ReflectionClass<object>|null */
    private function load(string $manifestName): ?\ReflectionClass
    {
        $typeName = self::typeName($manifestName);

        if (!class_exists($typeName) && !interface_exists($typeName) && !enum_exists($typeName)) {
            return null;
        }

        return new \ReflectionClass($typeName);
    }

    /**
     * @param \ReflectionClass<object> $reflection
     * @param list<ManifestMember> $members
     */
    private function checkRecord(string $owner, \ReflectionClass $reflection, array $members): void
    {
        if ($reflection->isInterface() || $reflection->isEnum() || !$reflection->isFinal() || !$reflection->isReadOnly()) {
            $this->problems[] = "{$owner}: expected a final readonly class";

            return;
        }

        $phpMembers = array_values(array_filter($members, static fn (ManifestMember $member): bool => $member->existsInPhp()));
        $parameters = $reflection->getConstructor()?->getParameters() ?? [];
        $this->compareNames(
            $owner,
            array_map(static fn (ManifestMember $member): string => $member->name, $phpMembers),
            array_map(static fn (\ReflectionParameter $parameter): string => $parameter->getName(), $parameters),
        );
        $this->checkPublicProperties($owner, $reflection, $parameters);
        $this->checkNoExtraPublicMethod($owner, $reflection);

        foreach ($phpMembers as $member) {
            foreach ($parameters as $parameter) {
                if ($parameter->getName() === $member->name) {
                    $this->checkRecordMember("{$owner}.{$member->name}", $member, $parameter);
                }
            }
        }
    }

    /**
     * @param \ReflectionClass<object> $reflection
     * @param list<\ReflectionParameter> $parameters
     */
    private function checkPublicProperties(string $owner, \ReflectionClass $reflection, array $parameters): void
    {
        foreach ($parameters as $parameter) {
            if (!$parameter->isPromoted() || !$reflection->getProperty($parameter->getName())->isPublic()) {
                $this->problems[] = "{$owner}.{$parameter->getName()}: a member must be a public promoted property";
            }
        }

        $promotedNames = array_map(static fn (\ReflectionParameter $parameter): string => $parameter->getName(), $parameters);

        foreach ($reflection->getProperties(\ReflectionProperty::IS_PUBLIC) as $property) {
            if (!in_array($property->getName(), $promotedNames, true)) {
                $this->problems[] = "{$owner}: public property {$property->getName()} is not in the shape manifest";
            }
        }
    }

    /** @param \ReflectionClass<object> $reflection */
    private function checkNoExtraPublicMethod(string $owner, \ReflectionClass $reflection): void
    {
        foreach ($this->publicMethods($reflection) as $method) {
            if (!$method->isStatic()) {
                $this->problems[] = "{$owner}: public method {$method->getName()} is not in the shape manifest";
            }
        }
    }

    private function checkRecordMember(string $where, ManifestMember $member, \ReflectionParameter $parameter): void
    {
        $allowsNull = $parameter->getType()?->allowsNull() ?? true;
        $defaultsToNull = $parameter->isDefaultValueAvailable() && $parameter->getDefaultValue() === null;

        if ($member->optional && $member->nullable) {
            $this->problems[] = "{$where}: an optional and nullable member is a Field, not a record member";
        } elseif ($member->optional && !$defaultsToNull) {
            $this->problems[] = "{$where}: an optional member must default to null";
        } elseif (!$member->optional && $parameter->isDefaultValueAvailable()) {
            $this->problems[] = "{$where}: a required member must have no default";
        } elseif ($member->nullable && !$allowsNull) {
            $this->problems[] = "{$where}: a nullable member must allow null";
        } elseif (!$member->nullable && !$member->optional && $allowsNull) {
            $this->problems[] = "{$where}: a member that is not nullable must not allow null";
        }

        $this->checkEnumType($where, $member, $parameter->getType());
    }

    private function checkEnumType(string $where, ManifestMember $member, ?\ReflectionType $type): void
    {
        if ($member->enum === null) {
            return;
        }

        $found = $type instanceof \ReflectionNamedType ? $type->getName() : (string) $type;

        if ($found !== self::typeName($member->enum)) {
            $this->problems[] = "{$where}: expected the enum {$member->enum}, found {$found}";
        }
    }

    /**
     * @param \ReflectionClass<object> $reflection
     * @param list<ManifestMember> $members
     */
    private function checkInterface(string $owner, \ReflectionClass $reflection, array $members): void
    {
        if (!$reflection->isInterface()) {
            $this->problems[] = "{$owner}: expected an interface";

            return;
        }

        $phpMembers = array_values(array_filter($members, static fn (ManifestMember $member): bool => $member->existsInPhp()));
        $methods = $this->publicMethods($reflection);
        $this->compareNames(
            $owner,
            array_map(static fn (ManifestMember $member): string => $member->name, $phpMembers),
            array_map(static fn (\ReflectionMethod $method): string => $method->getName(), $methods),
        );

        // A return type cannot tell optional from nullable apart: both allow null, a required member does not.
        foreach ($phpMembers as $member) {
            foreach ($methods as $method) {
                if ($method->getName() !== $member->name) {
                    continue;
                }

                $where = "{$owner}.{$member->name}";
                $allowsNull = $method->getReturnType()?->allowsNull() ?? true;

                if ($allowsNull !== ($member->optional || $member->nullable)) {
                    $this->problems[] = $allowsNull
                        ? "{$where}: a required member must not allow null"
                        : "{$where}: an optional or nullable member must allow null";
                }

                $this->checkEnumType($where, $member, $method->getReturnType());
            }
        }
    }

    /** @param \ReflectionClass<object> $reflection */
    private function checkHook(ManifestType $type, \ReflectionClass $reflection): void
    {
        if (!$reflection->isInterface()) {
            $this->problems[] = "{$type->name}: expected an interface";

            return;
        }

        $this->checkMethods($type, $this->publicMethods($reflection));
    }

    /** @param list<\ReflectionMethod> $methods */
    private function checkMethods(ManifestType $type, array $methods): void
    {
        $this->compareNames(
            $type->name,
            array_map(static fn (ManifestMethod $method): string => $method->name, $type->methods),
            array_map(static fn (\ReflectionMethod $method): string => $method->getName(), $methods),
        );

        foreach ($type->methods as $expected) {
            foreach ($methods as $method) {
                if ($method->getName() === $expected->name) {
                    $this->checkSignature($type->name, $expected, $method);
                }
            }
        }
    }

    private function checkSignature(string $owner, ManifestMethod $expected, \ReflectionMethod $method): void
    {
        $where = "{$owner}.{$expected->name}";
        $names = array_map(static fn (\ReflectionParameter $parameter): string => $parameter->getName(), $method->getParameters());

        if ($names !== $expected->parameters) {
            $this->problems[] = "{$where}: parameters (" . implode(', ', $names) . '), expected (' . implode(', ', $expected->parameters) . ')';
        }

        if ($method->isStatic() !== $expected->isStatic) {
            $this->problems[] = "{$where}: static is not " . var_export($expected->isStatic, true);
        }

        $returnType = $method->getReturnType();
        $found = $returnType instanceof \ReflectionNamedType ? self::shortName($returnType->getName()) : (string) $returnType;

        if ($expected->returns !== null && $found !== $expected->returns) {
            $this->problems[] = "{$where}: returns {$found}, expected {$expected->returns}";
        }
    }

    /** @param \ReflectionClass<object> $union */
    private function checkUnion(ManifestType $type, \ReflectionClass $union): void
    {
        if (!$union->isInterface() || $this->publicMethods($union) !== []) {
            $this->problems[] = "{$type->name}: expected an interface without methods";

            return;
        }

        $expectedArms = [];

        foreach ($type->arms as $arm) {
            $armName = $arm->type ?? $type->name . self::NESTED_TYPE_SEPARATOR . $arm->name;
            $expectedArms[] = self::typeName($armName);

            if ($arm->name === null) {
                continue;
            }

            $armClass = $this->load($armName);

            if ($armClass === null) {
                $this->problems[] = "{$armName}: no PHP type of this name";
                continue;
            }

            $this->checkRecord($armName, $armClass, $arm->members);
        }

        $implementations = array_values(array_filter(
            $this->packageTypes,
            static fn (string $typeName): bool => $typeName !== $union->getName() && is_subclass_of($typeName, $union->getName()),
        ));
        sort($expectedArms);

        if ($implementations !== $expectedArms) {
            $this->problems[] = "{$type->name}: implemented by [" . implode(', ', $implementations) . '], expected [' . implode(', ', $expectedArms) . ']';
        }
    }

    /** @param \ReflectionClass<object> $reflection */
    private function checkEnum(ManifestType $type, \ReflectionClass $reflection): void
    {
        $enumName = $reflection->getName();

        if (!enum_exists($enumName)) {
            $this->problems[] = "{$type->name}: expected an enum";

            return;
        }

        $enum = new \ReflectionEnum($enumName);
        $values = array_map(
            static fn (\ReflectionEnumUnitCase $case): mixed => $case instanceof \ReflectionEnumBackedCase ? $case->getBackingValue() : $case->getName(),
            $enum->getCases(),
        );

        if ($values !== $type->values) {
            $this->problems[] = "{$type->name}: values [" . implode(', ', array_map(strval(...), $values)) . '], expected [' . implode(', ', $type->values) . ']';
        }
    }

    /** @param \ReflectionClass<object> $reflection */
    private function checkClass(ManifestType $type, \ReflectionClass $reflection): void
    {
        if ($reflection->isInterface() || $reflection->isEnum() || !$reflection->isFinal()) {
            $this->problems[] = "{$type->name}: a class must be final";
        }

        if ($reflection->getConstructor()?->isPublic() ?? true) {
            $this->problems[] = "{$type->name}: the constructor must be private; the class is built by its static factories";
        }

        $this->checkMethods($type, $this->publicMethods($reflection));
    }

    /**
     * @param \ReflectionClass<object> $reflection
     *
     * @return list<\ReflectionMethod> the public methods the type declares, magic methods left out
     */
    private function publicMethods(\ReflectionClass $reflection): array
    {
        return array_values(array_filter(
            $reflection->getMethods(\ReflectionMethod::IS_PUBLIC),
            static fn (\ReflectionMethod $method): bool => $method->getDeclaringClass()->getName() === $reflection->getName()
                && !str_starts_with($method->getName(), self::MAGIC_METHOD_PREFIX),
        ));
    }

    /**
     * @param list<string> $expected
     * @param list<string> $actual
     */
    private function compareNames(string $owner, array $expected, array $actual): void
    {
        foreach (array_diff($expected, $actual) as $name) {
            $this->problems[] = "{$owner}: missing member {$name}";
        }

        foreach (array_diff($actual, $expected) as $name) {
            $this->problems[] = "{$owner}: member {$name} is not in the shape manifest";
        }
    }

    /** @param list<string> $expectedNames */
    private function checkNoUnlistedType(array $expectedNames): void
    {
        $expectedTypes = array_map(self::typeName(...), $expectedNames);

        foreach ($this->packageTypes as $typeName) {
            $isInternal = str_contains((string) (new \ReflectionClass($typeName))->getDocComment(), self::INTERNAL_TAG);

            if (!$isInternal && !in_array($typeName, $expectedTypes, true)) {
                $manifestName = str_replace('\\', self::NESTED_TYPE_SEPARATOR, substr($typeName, strlen(self::NAMESPACE_PREFIX)));
                $this->problems[] = "{$manifestName}: a PHP type that is not in the shape manifest";
            }
        }
    }

    private static function shortName(string $typeName): string
    {
        $separator = strrpos($typeName, '\\');

        return $separator === false ? $typeName : substr($typeName, $separator + 1);
    }
}
