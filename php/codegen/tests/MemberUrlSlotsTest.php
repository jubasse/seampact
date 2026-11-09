<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\KeptForms;
use Seampact\Codegen\Refusals;
use Seampact\Codegen\Tests\Support\FixedReleases;
use Seampact\Codegen\Tests\Support\ReferenceContract;
use Seampact\Codegen\Tests\Support\ReferenceIr;
use Seampact\Ir\Run\GenerationRefusedException;

/**
 * A format that writes a member URL (`$itemSelf`, or `$self` on an item) needs the member route of the resource beside
 * the operation: without one, the generation refuses by name rather than drop the id or write the collection's URL.
 */
final class MemberUrlSlotsTest extends TestCase
{
    private const RULE = 'format.self.member-route';

    public function testAPageOfACollectionWithNoMemberRouteIsRefused(): void
    {
        $problems = self::memberRouteProblems(['listTasks'], static function (): void {
        });

        self::assertCount(1, $problems);
        self::assertStringContainsString("'\$itemSelf'", $problems[0]['message']);
        self::assertSame("entry 'server' /operations/0 (operation 'listTasks')", $problems[0]['where']);
    }

    public function testAnItemOfACollectionWithNoMemberRouteIsRefused(): void
    {
        $problems = self::memberRouteProblems(['createTask'], static function (): void {
        });

        self::assertCount(1, $problems);
        self::assertStringContainsString("'\$self'", $problems[0]['message']);
        self::assertStringContainsString("(operation 'createTask')", $problems[0]['where'] ?? '');
    }

    public function testAListBesideItsMemberRouteIsNotRefused(): void
    {
        self::assertSame([], self::memberRouteProblems(['listTasks', 'createTask', 'getTask'], static function (): void {
        }));
    }

    public function testAListAtAPathThatIsNotUnderTheMembersParentPathIsRefused(): void
    {
        $problems = self::memberRouteProblems(['listTasks', 'getTask'], static function (array $operations): void {
            $operations['listTasks']->path = '/v1/me/tasks';
        });

        self::assertCount(1, $problems);
        self::assertStringContainsString("(operation 'listTasks')", $problems[0]['where'] ?? '');
    }

    public function testAListWhosePathParamIsNamedOtherwiseThanTheMembersIsRefused(): void
    {
        $problems = self::memberRouteProblems(['listTasks', 'getTask'], static function (array $operations): void {
            $operations['listTasks']->path = '/v1/channels/{chan}/tasks';
        });

        self::assertCount(1, $problems);
    }

    public function testAnItemOfASingleHasNoMemberRouteToNeed(): void
    {
        self::assertSame([], self::memberRouteProblems(['getPreferences'], static function (): void {
        }));
    }

    /**
     * @param list<string> $kept
     * @param callable(array<string, \stdClass>): void $edit
     * @return list<array{message: string, where: ?string}>
     */
    private static function memberRouteProblems(array $kept, callable $edit): array
    {
        $document = ReferenceIr::keeping(ReferenceContract::document('tasks.ir.json', 'pack-api-platform'), $kept);
        self::assertIsArray($document->operations);

        /** @var array<string, \stdClass> $operations */
        $operations = [];
        foreach ($document->operations as $operation) {
            self::assertInstanceOf(\stdClass::class, $operation);
            self::assertIsString($operation->id);
            $operations[$operation->id] = $operation;
        }
        $edit($operations);

        $refusals = new Refusals('server', 'test', 'seampact/test');
        new KeptForms(ReferenceIr::read($document), $refusals, new FixedReleases(null));

        try {
            $refusals->throwIfAny();
        } catch (GenerationRefusedException $refused) {
            return array_values(array_map(
                static fn ($problem): array => ['message' => $problem->message, 'where' => $problem->where],
                array_filter($refused->problems, static fn ($problem): bool => $problem->code === self::RULE),
            ));
        }

        return [];
    }
}
