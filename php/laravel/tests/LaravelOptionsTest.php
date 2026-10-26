<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Seampact\Ir\Config\ConfigProblem;
use Seampact\Ir\Run\GenerationRefusedException;
use Seampact\Laravel\FrameworkEtagMode;
use Seampact\Laravel\LaravelOptions;
use Seampact\Laravel\ResponsesMode;
use Seampact\Laravel\RoutesForm;
use Seampact\Laravel\RulesMode;

final class LaravelOptionsTest extends TestCase
{
    private const NAMESPACE = 'App\\Contracts\\Tasks';

    public function testTheDefaultsHoldWithOnlyTheNamespace(): void
    {
        $options = LaravelOptions::parse((object) ['namespace' => self::NAMESPACE], self::NAMESPACE, 'server');

        self::assertSame(self::NAMESPACE, $options->namespace);
        self::assertSame(LaravelOptions::DEFAULT_INDENT_SPACES, $options->indentSpaces);
        self::assertSame(RoutesForm::Macro, $options->routes);
        self::assertSame(RulesMode::Native, $options->rules);
        self::assertSame(ResponsesMode::Strict, $options->responses);
        self::assertFalse($options->bodyValidation);
        self::assertSame(FrameworkEtagMode::Strip, $options->frameworkEtag);
        self::assertTrue($options->catchAll);
    }

    public function testEveryListedValueIsRead(): void
    {
        $options = LaravelOptions::parse((object) [
            'namespace' => self::NAMESPACE,
            'indent' => 2,
            'routes' => 'file',
            'rules' => 'seampact-consistent',
            'responses' => 'warn',
            'bodyValidation' => true,
            'frameworkEtag' => 'keep',
            'catchAll' => false,
            'handlers' => 'perResource',
        ], self::NAMESPACE, 'server');

        self::assertSame(2, $options->indentSpaces);
        self::assertSame(RoutesForm::File, $options->routes);
        self::assertSame(RulesMode::SeampactConsistent, $options->rules);
        self::assertSame(ResponsesMode::Warn, $options->responses);
        self::assertTrue($options->bodyValidation);
        self::assertSame(FrameworkEtagMode::Keep, $options->frameworkEtag);
        self::assertFalse($options->catchAll);
    }

    /** @return iterable<string, array{array<string, mixed>, list<string>}> */
    public static function refusedOptions(): iterable
    {
        yield 'an unknown key, by name' => [['namespace' => self::NAMESPACE, 'package' => 'x'], ['options.unknown']];
        yield 'no namespace' => [[], ['options.namespace.missing']];
        yield 'a namespace that is not PHP' => [['namespace' => 'App\\1Tasks'], ['options.namespace.invalid']];
        yield 'a namespace PSR-4 does not map there' => [['namespace' => 'App\\Other'], ['options.namespace.mismatch']];
        yield 'an indent out of range' => [['namespace' => self::NAMESPACE, 'indent' => 0], ['options.indent.invalid']];
        yield 'a routes form outside its set' => [['namespace' => self::NAMESPACE, 'routes' => 'attributes'], ['options.routes.invalid']];
        yield 'a rules mode outside its set' => [['namespace' => self::NAMESPACE, 'rules' => 'strict'], ['options.rules.invalid']];
        yield 'a flag that is not a boolean' => [['namespace' => self::NAMESPACE, 'catchAll' => 'yes'], ['options.catchAll.invalid']];
        yield 'a layout' => [['namespace' => self::NAMESPACE, 'layout' => 'flat'], ['options.layout.unsupported']];
        yield 'handlers per operation' => [['namespace' => self::NAMESPACE, 'handlers' => 'perOperation'], ['options.handlers.unsupported']];
        yield 'a naming option' => [['namespace' => self::NAMESPACE, 'enumCase' => 'upper'], ['options.naming.unsupported']];
        yield 'every problem at once' => [['routes' => 1, 'extra' => true], ['options.namespace.missing', 'options.routes.invalid', 'options.unknown']];
    }

    /**
     * @param array<string, mixed> $raw
     * @param list<string> $expectedCodes
     */
    #[DataProvider('refusedOptions')]
    public function testARefusedOptionIsNamedWithItsCode(array $raw, array $expectedCodes): void
    {
        try {
            LaravelOptions::parse((object) $raw, self::NAMESPACE, 'server');
            self::fail('The options were accepted.');
        } catch (GenerationRefusedException $refused) {
            $codes = array_map(static fn (ConfigProblem $problem): string => $problem->code, $refused->problems);
            sort($codes);

            self::assertSame($expectedCodes, $codes);
            self::assertStringStartsWith("entry 'server' /options/", (string) $refused->problems[0]->where);
        }
    }
}
