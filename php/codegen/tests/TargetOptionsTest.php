<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\FrameworkEtagMode;
use Seampact\Codegen\OptionValues;
use Seampact\Codegen\Refusals;
use Seampact\Codegen\ResponsesMode;
use Seampact\Codegen\RulesMode;
use Seampact\Codegen\TargetOptions;
use Seampact\Ir\Config\ConfigProblem;
use Seampact\Ir\Run\GenerationRefusedException;

final class TargetOptionsTest extends TestCase
{
    private const NAMESPACE = 'App\\Contracts\\Tasks';

    public function testLeftOutOptionsTakeTheirDefaults(): void
    {
        $options = TargetOptions::read(self::values(new \stdClass(), new Refusals('server', 'symfony', 'seampact/symfony')), self::NAMESPACE);

        self::assertEquals(new TargetOptions(self::NAMESPACE, TargetOptions::DEFAULT_INDENT_SPACES, RulesMode::Native, ResponsesMode::Strict, false, FrameworkEtagMode::Strip, true), $options);
    }

    public function testATargetKeyIsKnownAndReadByTheTarget(): void
    {
        $refusals = new Refusals('server', 'laravel', 'seampact/laravel');
        $values = new OptionValues((object) ['routes' => 'warn'], 'laravel', [...TargetOptions::KEYS, 'routes'], $refusals);

        self::assertSame(ResponsesMode::Warn, $values->choice('routes', ResponsesMode::Strict));
        self::assertTrue($refusals->isEmpty());
    }

    /**
     * @param array<string, mixed> $raw
     * @param list<string> $codes
     */
    #[DataProvider('refusedOptions')]
    public function testEachRefusedOptionIsNamed(array $raw, array $codes): void
    {
        $refusals = new Refusals('server', 'symfony', 'seampact/symfony');
        TargetOptions::read(self::values((object) $raw, $refusals), self::NAMESPACE);

        try {
            $refusals->throwIfAny();
            self::fail('The options were not refused.');
        } catch (GenerationRefusedException $refused) {
            $found = array_map(static fn (ConfigProblem $problem): string => $problem->code, $refused->problems);
            sort($found);
            self::assertSame($codes, $found);
        }
    }

    /** @return iterable<string, array{array<string, mixed>, list<string>}> */
    public static function refusedOptions(): iterable
    {
        yield 'an unknown key' => [['package' => 'x'], ['options.unknown']];
        yield 'a namespace, which composer.json gives' => [['namespace' => 'App\\Other'], ['options.unknown']];
        yield 'an indent out of range' => [['indent' => 9], ['options.indent.invalid']];
        yield 'a rules mode outside its set' => [['rules' => 'strict'], ['options.rules.invalid']];
        yield 'a flag that is not a boolean' => [['catchAll' => 'yes'], ['options.catchAll.invalid']];
        yield 'a layout' => [['layout' => 'flat'], ['options.layout.unsupported']];
        yield 'one interface per operation' => [['handlers' => 'perOperation'], ['options.handlers.unsupported']];
        yield 'a naming option' => [['suffixes' => new \stdClass()], ['options.naming.unsupported']];
    }

    public function testAnUnknownKeyNamesTheTargetAndItsKeys(): void
    {
        $refusals = new Refusals('server', 'symfony', 'seampact/symfony');
        self::values((object) ['package' => 'x'], $refusals);

        try {
            $refusals->throwIfAny();
            self::fail('The option was not refused.');
        } catch (GenerationRefusedException $refused) {
            self::assertStringContainsString("not one the symfony target knows; it takes 'indent', 'layout'", $refused->problems[0]->message);
            self::assertSame("entry 'server' /options/package", $refused->problems[0]->where);
        }
    }

    private static function values(\stdClass $raw, Refusals $refusals): OptionValues
    {
        return new OptionValues($raw, 'symfony', TargetOptions::KEYS, $refusals);
    }
}
