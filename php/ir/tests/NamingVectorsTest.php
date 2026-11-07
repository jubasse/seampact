<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Ir\Naming\Identifier;
use Seampact\Ir\Naming\IrName;
use Seampact\Ir\Naming\NameSource;
use Seampact\Ir\Naming\NamingRole;
use Seampact\Ir\Naming\OperationIdCase;
use Seampact\Ir\Naming\SplitName;
use Seampact\Ir\Tests\Support\Documents;
use Seampact\Ir\Tests\Support\Json;

// The shared naming vectors (ADR 0007 section 6) against the PHP implementation: the `php` column.
final class NamingVectorsTest extends TestCase
{
    private const NO_SEGMENT = 'no-segment';

    /** @return list<\stdClass> */
    private function vectors(): array
    {
        return array_map(
            Json::object(...),
            Json::list(Json::decodeFile(Documents::repositoryRoot() . '/packages/core/spec/vectors/naming/vectors.json')),
        );
    }

    /** @return list<string>|null */
    private function segmentsOfVector(\stdClass $vector): ?array
    {
        if (Json::has($vector, 'owner')) {
            return Json::strings($vector, 'owner');
        }

        return SplitName::segmentsOf(
            Json::string($vector, 'written'),
            NameSource::from(Json::string($vector, 'source')),
            Json::optionalString($vector, 'codeName'),
            Json::optionalInt($vector, 'position'),
        );
    }

    public function testVectors(): void
    {
        $vectors = $this->vectors();
        self::assertGreaterThan(100, count($vectors));

        foreach ($vectors as $vector) {
            $id = Json::string($vector, 'id');
            $segments = $this->segmentsOfVector($vector);

            if (Json::has($vector, 'error')) {
                self::assertSame(self::NO_SEGMENT, Json::string($vector, 'error'), $id);
                self::assertNull($segments, $id);
                continue;
            }

            self::assertNotNull($segments, $id);
            self::assertSame(Json::strings($vector, 'segments'), $segments, $id);
            $name = new IrName($segments, NamingRole::from(Json::string($vector, 'role')), Json::optionalInt($vector, 'status'));

            self::assertSame(Json::string(Json::object(Json::member($vector, 'expected')), 'php'), Identifier::of($name), "$id php");

            if (Json::has($vector, 'operationId')) {
                $operationId = Json::object(Json::member($vector, 'operationId'));

                self::assertSame(Json::string($operationId, 'camel'), Identifier::operationId($segments, OperationIdCase::Camel), "$id camel");
                self::assertSame(Json::string($operationId, 'snake'), Identifier::operationId($segments, OperationIdCase::Snake), "$id snake");
            }
        }
    }

    public function testTheVectorsCoverTheRolesAndTheSources(): void
    {
        $vectors = $this->vectors();
        $roles = array_values(array_unique(array_map(static fn (\stdClass $vector): string => Json::string($vector, 'role'), $vectors)));
        $sources = array_values(array_unique(array_map(
            static fn (\stdClass $vector): string => Json::optionalString($vector, 'source') ?? '',
            $vectors,
        )));
        sort($roles);
        sort($sources);
        $knownRoles = array_map(static fn (NamingRole $role): string => $role->value, NamingRole::cases());
        sort($knownRoles);

        self::assertSame($knownRoles, $roles);
        self::assertSame(['', 'enumValue', 'name', 'right'], $sources);
    }

    public function testAnEnumValueNeedsItsPosition(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        SplitName::segmentsOf('done', NameSource::EnumValue);
    }

    public function testAnEnumValuePositionStartsAtOne(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        SplitName::segmentsOf('done', NameSource::EnumValue, null, 0);
    }

    /** @return iterable<string, array{callable(): mixed}> */
    public static function malformedNames(): iterable
    {
        yield 'upper-case segment' => [static fn (): IrName => new IrName(['Upper'], NamingRole::Schema)];
        yield 'response without status' => [static fn (): IrName => new IrName(['tasks'], NamingRole::Response)];
        yield 'response status out of range' => [static fn (): IrName => new IrName(['tasks'], NamingRole::Response, 404)];
        yield 'status on another role' => [static fn (): IrName => new IrName(['tasks'], NamingRole::Input, 200)];
        yield 'no segment' => [static fn (): string => Identifier::of(new IrName([], NamingRole::Schema))];
        yield 'operation id without segment' => [static fn (): string => Identifier::operationId([])];
        yield 'operation id with an upper-case segment' => [static fn (): string => Identifier::operationId(['Get'])];
        yield 'snake operation id with a dash' => [
            static fn (): string => Identifier::operationId(['list', 'my-tasks'], OperationIdCase::Snake),
        ];
    }

    /** @param callable(): mixed $build */
    #[\PHPUnit\Framework\Attributes\DataProvider('malformedNames')]
    public function testAMalformedNameIsRefused(callable $build): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $build();
    }
}
