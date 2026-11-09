<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests;

use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Golden\TasksConsistent\Symfony\TasksContract;
use Seampact\Hooks\IdempotencyStore;
use Seampact\Symfony\Runtime\HookCheckWarmer;
use Seampact\Symfony\Runtime\Hooks;
use Seampact\Symfony\Tests\Support\DirectInputRules;
use Seampact\Symfony\Tests\Support\InputRulesContract;
use Symfony\Component\DependencyInjection\ServiceLocator;

/** The hook check the cache warmer runs, on the golden api whose writes the boundary keeps idempotent. */
final class HookCheckWarmerTest extends TestCase
{
    public function testAWrongTypedIdempotencyStoreIsListedWithTheOtherProblems(): void
    {
        $hooks = new Hooks(new ServiceLocator([]), [], [], null, new NullLogger(), new \stdClass());

        $problems = HookCheckWarmer::problems($hooks, ApiContract::of(TasksContract::class));

        $storeProblems = array_values(array_filter($problems, static fn (string $problem): bool => str_contains($problem, IdempotencyStore::class)));
        self::assertCount(1, $storeProblems);
        self::assertStringContainsString('is stdClass', $storeProblems[0]);
        self::assertGreaterThan(1, count($problems));
    }

    public function testAnInputRuleServiceOfNoApiInterfaceStopsTheBootEvenWithTheHookCheckOff(): void
    {
        $hooks = new Hooks(new ServiceLocator([]), [], [], null, new NullLogger(), null, false, [new DirectInputRules()]);
        $warmer = new HookCheckWarmer($hooks, InputRulesContract::class, false);

        $this->expectException(\LogicException::class);
        $this->expectExceptionMessageMatches('/DirectInputRules does not implement .*TasksInputRules/');

        $warmer->warmUp(sys_get_temp_dir());
    }

    public function testNoInputRuleServiceIsNoProblem(): void
    {
        $hooks = new Hooks(new ServiceLocator([]), [], [], null, new NullLogger());

        self::assertSame([], HookCheckWarmer::inputRuleProblems($hooks, ApiContract::of(InputRulesContract::class)));
    }
}
