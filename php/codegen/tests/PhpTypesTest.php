<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\PhpClassFile;
use Seampact\Codegen\PhpType;
use Seampact\Codegen\PhpTypes;
use Seampact\Codegen\Tests\Support\AppTypeNames;
use Seampact\Codegen\Tests\Support\ReferenceIr;
use Seampact\Ir\Model\ObjectSchema;
use Seampact\Ir\Model\Param;
use Seampact\Ir\Model\Property;

final class PhpTypesTest extends TestCase
{
    public function testAPropertyBothOptionalAndNullableIsAField(): void
    {
        [$type, $file] = $this->propertyType(['optional' => true, 'nullable' => true, 'type' => ['kind' => 'scalar', 'type' => 'string', 'refinements' => new \stdClass()]]);

        self::assertSame(PhpTypes::FIELD_CLASS, $type->native);
        self::assertSame('Field<string>', $type->doc);
        self::assertTrue($type->needsDoc());
        self::assertSame(['Field' => PhpTypes::FIELD_CLASS], $file->namespace->getUses());
    }

    public function testANullableListIsAnArrayWithAListDocOrNull(): void
    {
        [$type] = $this->propertyType(['nullable' => true, 'type' => ['kind' => 'array', 'items' => ['kind' => 'scalar', 'type' => 'integer', 'refinements' => new \stdClass()]]]);

        self::assertSame('array', $type->native);
        self::assertSame('list<int>|null', $type->doc);
        self::assertTrue($type->nullable);
    }

    public function testAnOptionalDateTimePropertyIsANullableImportedClass(): void
    {
        [$type, $file] = $this->propertyType(['optional' => true, 'type' => ['kind' => 'scalar', 'type' => 'string', 'format' => 'date-time', 'refinements' => new \stdClass()]]);

        self::assertSame('DateTimeImmutable', $type->native);
        self::assertSame('?DateTimeImmutable', $type->doc);
        self::assertFalse($type->needsDoc());
        self::assertSame(['DateTimeImmutable' => 'DateTimeImmutable'], $file->namespace->getUses());
    }

    public function testAnOptionalParameterIsNullableAndARequiredOneIsNot(): void
    {
        $ir = ReferenceIr::read(ReferenceIr::keeping(ReferenceIr::document(), ['getTask']));
        $param = $ir->operations[0]->params->path[0];
        $types = new PhpTypes(new AppTypeNames());
        $file = new PhpClassFile('App\\Http\\GetTaskPath');

        self::assertSame('string', $types->ofParam($param, $file)->doc);
        $optional = new Param($param->name, $param->type, false);
        self::assertSame('?string', $types->ofParam($optional, $file)->doc);
    }

    /**
     * The PHP type of a property added to the reference `Task` schema with `$members` over a required string.
     *
     * @param array<string, mixed> $members
     * @return array{PhpType, PhpClassFile}
     */
    private function propertyType(array $members): array
    {
        $document = ReferenceIr::keeping(ReferenceIr::document(), ['getTask']);
        $schemas = get_object_vars($document)['schemas'] ?? null;
        $task = $schemas instanceof \stdClass ? (get_object_vars($schemas)['Task'] ?? null) : null;
        self::assertInstanceOf(\stdClass::class, $task);
        self::assertIsArray($task->properties);

        $added = json_decode(json_encode(['name' => 'added', 'optional' => false, 'nullable' => false, 'sensitive' => false, 'deprecated' => false, 'docs' => new \stdClass(), 'extensions' => new \stdClass(), 'origin' => ['layer' => 'api', 'pointer' => '/added'], ...$members], JSON_THROW_ON_ERROR), false, 512, JSON_THROW_ON_ERROR);
        $task->properties[] = $added;

        $schema = ReferenceIr::read($document)->schemas['Task'] ?? null;
        self::assertInstanceOf(ObjectSchema::class, $schema);
        $property = $schema->properties[count($schema->properties) - 1];
        self::assertInstanceOf(Property::class, $property);

        $file = new PhpClassFile(AppTypeNames::NAMESPACE . '\\Task');

        return [(new PhpTypes(new AppTypeNames()))->ofProperty($property, $file), $file];
    }
}
