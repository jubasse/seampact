<?php

declare(strict_types=1);

namespace Seampact\Codegen;

use Seampact\Ir\Model\Enum_;
use Seampact\Ir\Model\ObjectSchema;
use Seampact\Ir\Naming\NameSource;
use Seampact\Ir\Naming\NamingRole;
use Seampact\Ir\Naming\SplitName;

/** The value types of the kept schemas: a `final readonly` class per object and a backed enum per enum. */
final class SchemaTypes
{
    public function __construct(private readonly TypeNames $names, private readonly PhpTypes $types, private readonly Refusals $refusals)
    {
    }

    /**
     * @param array<string, Enum_> $enums
     * @param array<string, ObjectSchema> $objects
     * @return list<PhpClassFile>
     */
    public function files(array $enums, array $objects): array
    {
        $files = [];

        foreach ($enums as $enumId => $enum) {
            $className = $this->names->enumClass($enumId);
            if ($className !== null) {
                $files[] = $this->enumFile($className, $enumId, $enum);
            }
        }

        foreach ($objects as $schemaId => $schema) {
            $className = $this->names->schemaClass($schemaId);
            if ($className !== null) {
                $files[] = $this->objectFile($className, $schemaId, $schema);
            }
        }

        return $files;
    }

    private function enumFile(string $className, string $enumId, Enum_ $enum): PhpClassFile
    {
        $file = new PhpClassFile($className);
        $type = $file->namespace->addEnum($file->shortName)->setType('string');
        $type->addComment(DocComments::of($enum->docs, "The values of enum '{$enumId}'."));
        $cases = [];

        foreach ($enum->values as $position => $value) {
            $codeName = $enum->codeNames[$value] ?? null;
            $segments = $codeName->segments ?? SplitName::segmentsOf($value, NameSource::EnumValue, null, $position + 1);
            $at = IrPlace::root()->below('enums', $enumId, 'values', $position);
            if ($segments === null || $segments === []) {
                $this->refusals->inconsistent('enum.value.no-segment', "The enum value '{$value}' yields no name segment", $at);
                continue;
            }

            $case = PhpNames::identifier($segments, NamingRole::EnumMember);
            if (isset($cases[strtolower($case)])) {
                $this->refusals->add('name.collision', "The enum case '{$case}' would be written for both '{$cases[strtolower($case)]}' and '{$value}' of enum '{$enumId}'.", 'Give one of the values a `codeName` in the contract.', $at);
                continue;
            }

            $cases[strtolower($case)] = $value;
            $type->addCase($case, $value);
        }

        return $file;
    }

    private function objectFile(string $className, string $schemaId, ObjectSchema $schema): PhpClassFile
    {
        $file = new PhpClassFile($className);
        $class = $file->namespace->addClass($file->shortName)->setFinal()->setReadOnly();
        $class->addComment(DocComments::of($schema->docs, "The schema '{$schemaId}'."));
        $constructor = $class->addMethod('__construct');
        $members = [];

        foreach ($schema->properties as $index => $property) {
            $at = IrPlace::root()->below('schemas', $schemaId, 'properties', $index);
            $member = PhpNames::memberIdentifier($property->name, $property->codeName);
            if ($member === null) {
                $this->refusals->inconsistent('property.no-segment', "The property '{$property->name}' yields no name segment", $at);
                continue;
            }

            if (isset($members[strtolower($member)])) {
                $this->refusals->add('name.collision', "The property '\${$member}' would be written for both '{$members[strtolower($member)]}' and '{$property->name}' of schema '{$schemaId}'.", 'Give one of the properties a `codeName` in the contract.', $at);
                continue;
            }

            $members[strtolower($member)] = $property->name;
            PhpTypes::promote($constructor, $member, $this->types->member($property->type, $property->optional, $property->nullable, $file));
        }

        return $file;
    }
}
