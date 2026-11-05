<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\RequirementParams;
use Seampact\Hooks\RequirementKind;

/** The params a decider receives: the right's generated params class, or none for a right without params. */
final class RequirementParamsTest extends TestCase
{
    public function testTheParamsOfARightAreItsGeneratedParamsClass(): void
    {
        $params = RequirementParams::of(ApiContract::of(TypedParamsContract::class), RequirementKind::Right, 'roles', ['allowed' => ['owner', 'editor']]);

        self::assertInstanceOf(TypedParamsRoles::class, $params);
        self::assertSame(['owner', 'editor'], $params->allowed);
    }

    public function testARightWithoutParamsGivesNoParams(): void
    {
        self::assertNull(RequirementParams::of(ApiContract::of(TypedParamsContract::class), RequirementKind::Right, 'tasks.read', null));
    }
}
