<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\RequirementParams;
use Seampact\Codegen\Tests\Support\RequirementUseSite;
use Seampact\Golden\TasksConsistent\Symfony\TasksContract;
use Seampact\Golden\TasksConsistent\Schemas\ReauthIntent;
use Seampact\Golden\TasksConsistent\Schemas\RecentAuthParams;
use Seampact\Golden\TasksConsistent\Schemas\Role;
use Seampact\Golden\TasksConsistent\Schemas\RolesParams;
use Seampact\Hooks\RequirementKind;

/** The params a decider receives on the golden reference api: the generated params class of each right or rule, none for a right without params. */
final class TypedRequirementParamsTest extends TestCase
{
    public function testTheDecideRequestOfARightCarriesItsGeneratedParamsClass(): void
    {
        $params = self::paramsOf('createTask', RequirementKind::Right, 'roles');

        self::assertInstanceOf(RolesParams::class, $params);
        self::assertSame([Role::Owner, Role::Editor], $params->allowed);
    }

    public function testTheDecideRequestOfARuleCarriesItsGeneratedParamsClass(): void
    {
        $params = self::paramsOf('purgeTask', RequirementKind::Rule, 'recentAuth');

        self::assertInstanceOf(RecentAuthParams::class, $params);
        self::assertSame(ReauthIntent::PurgeTask, $params->intent);
    }

    public function testTheDecideRequestOfARightWithoutParamsCarriesNone(): void
    {
        self::assertNull(self::paramsOf('searchTasks', RequirementKind::Right, 'tasks.read'));
    }

    private static function paramsOf(string $operationId, RequirementKind $kind, string $name): ?object
    {
        $contract = ApiContract::of(TasksContract::class);

        return RequirementParams::of($contract, $kind, $name, RequirementUseSite::params($contract, $operationId, $kind, $name));
    }
}
