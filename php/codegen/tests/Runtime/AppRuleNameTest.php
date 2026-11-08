<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\AppRuleName;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Tests\Support\ScriptedHooks;
use Seampact\Hooks\RequestView;

/** An app rule renders as `app.<name>`; a name the wire cannot carry renders `app.invalid` and logs its fix once. */
final class AppRuleNameTest extends TestCase
{
    /** @return iterable<string, array{string, bool}> */
    public static function names(): iterable
    {
        yield 'a camel case name' => ['endAfterStart', true];
        yield 'a dotted name' => ['task.window-ok_1', true];
        yield 'a name starting with a digit' => ['1st', false];
        yield 'an empty name' => ['', false];
        yield 'a name with a space' => ['too long', false];
        yield 'a name of 65 characters' => [str_repeat('a', 65), false];
        yield 'a name of 64 characters' => [str_repeat('a', 64), true];
        yield 'a UUID shaped name' => ['3f2a9c1e-7b4d-4e5a-8c6f-1a2b3c4d5e6f', false];
    }

    #[DataProvider('names')]
    public function testAUsableNameIsPrefixed(string $name, bool $usable): void
    {
        self::assertSame($usable, AppRuleName::isUsable($name));
        self::assertSame($usable ? "app.{$name}" : 'app.invalid', AppRuleName::rendered(self::state(ScriptedHooks::none()), 'key', $name, 'fix'));
    }

    public function testAMissingNameIsInvalidAndItsFixIsLoggedOncePerRule(): void
    {
        $hooks = ScriptedHooks::none();
        $state = self::state($hooks);

        $rendered = [
            AppRuleName::rendered($state, 'body.note: once', null, 'name it'),
            AppRuleName::rendered($state, 'body.note: once', null, 'name it'),
            AppRuleName::rendered($state, 'body.end: other', null, 'name it'),
        ];

        self::assertSame([AppRuleName::INVALID, AppRuleName::INVALID, AppRuleName::INVALID], $rendered);

        self::assertCount(2, $hooks->logged);
        self::assertStringContainsString("operation 'createTask': an input rule (body.note: once) has no usable name", $hooks->logged[0]);
        self::assertStringEndsWith('name it', $hooks->logged[0]);
    }

    private static function state(ScriptedHooks $hooks): BoundaryState
    {
        return new BoundaryState(ApiContract::of(IdempotentContract::class), 'createTask', [], new RequestView('POST', '/v1/tasks', []), $hooks);
    }
}
