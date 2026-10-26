<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Ir\Run\GenerationRefusedException;
use Seampact\Symfony\FrameworkEtagMode;
use Seampact\Symfony\ResponsesMode;
use Seampact\Symfony\RulesMode;
use Seampact\Symfony\SymfonyOptions;

final class SymfonyOptionsTest extends TestCase
{
    private const NAMESPACE = 'App\\Contracts\\Tasks';

    public function testTheDefaultsHoldWhenOnlyTheNamespaceIsSet(): void
    {
        $options = SymfonyOptions::parse((object) ['namespace' => self::NAMESPACE], self::NAMESPACE, 'server');

        self::assertSame(self::NAMESPACE, $options->namespace);
        self::assertSame(SymfonyOptions::DEFAULT_INDENT_SPACES, $options->indentSpaces);
        self::assertSame(RulesMode::Native, $options->rules);
        self::assertSame(ResponsesMode::Strict, $options->responses);
        self::assertFalse($options->bodyValidation);
        self::assertSame(FrameworkEtagMode::Strip, $options->frameworkEtag);
        self::assertTrue($options->catchAll);
    }

    public function testEveryListedValueIsRead(): void
    {
        $options = SymfonyOptions::parse((object) [
            'namespace' => self::NAMESPACE,
            'indent' => 2,
            'rules' => 'seampact-consistent',
            'responses' => 'warn',
            'bodyValidation' => true,
            'frameworkEtag' => 'keep',
            'catchAll' => false,
            'handlers' => 'perResource',
        ], self::NAMESPACE, 'server');

        self::assertSame([2, RulesMode::SeampactConsistent, ResponsesMode::Warn, true, FrameworkEtagMode::Keep, false], [
            $options->indentSpaces, $options->rules, $options->responses, $options->bodyValidation, $options->frameworkEtag, $options->catchAll,
        ]);
    }

    public function testEveryWrongOptionIsRefusedByNameAtOnce(): void
    {
        self::assertSame(
            [
                'options.unknown', 'options.namespace.mismatch', 'options.indent.invalid', 'options.rules.invalid',
                'options.catchAll.invalid', 'options.layout.unsupported', 'options.handlers.unsupported', 'options.naming.unsupported',
            ],
            self::refusedCodes((object) [
                'namespace' => 'App\\Other',
                'indent' => 0,
                'rules' => 'strict',
                'catchAll' => 'yes',
                'layout' => 'flat',
                'handlers' => 'perOperation',
                'suffixes' => new \stdClass(),
                'mount' => '/api',
            ]),
        );
    }

    public function testAMissingOrMalformedNamespaceIsRefused(): void
    {
        self::assertSame(['options.namespace.missing'], self::refusedCodes(new \stdClass()));
        self::assertSame(['options.namespace.invalid'], self::refusedCodes((object) ['namespace' => 'App\\\\Tasks']));
    }

    /** @return list<string> */
    private static function refusedCodes(\stdClass $raw): array
    {
        try {
            SymfonyOptions::parse($raw, self::NAMESPACE, 'server');
        } catch (GenerationRefusedException $refused) {
            return array_map(static fn ($problem): string => $problem->code, $refused->problems);
        }

        self::fail('The options were accepted.');
    }
}
