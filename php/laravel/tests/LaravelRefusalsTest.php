<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Tests\Support\ReferenceContract;
use Seampact\Ir\Run\GenerationRefusedException;
use Seampact\Laravel\LaravelGenerator;

/**
 * What `generate` refuses by name: each form with the release that brings it (ADR 0023 "Refused by name or waiting"),
 * and the PHP names two wire names would share.
 */
final class LaravelRefusalsTest extends TestCase
{
    private const AFTER_ONE_ZERO = 'waits for a consumer after 1.0';

    public function testTwoParametersWithOnePhpNameAreRefusedAsACollision(): void
    {
        $document = ReferenceContract::withOperation('getTask', static function (\stdClass $operation): void {
            self::object($operation->params)->query = [
                self::param('page-size', false, ['kind' => 'scalar', 'type' => 'integer', 'refinements' => new \stdClass()]),
                self::param('pageSize', true, ['kind' => 'scalar', 'type' => 'string', 'refinements' => new \stdClass()]),
            ];
        });

        $refused = self::refused($document);

        self::assertArrayHasKey('name.collision', $refused);
        self::assertStringContainsString("'page-size' and 'pageSize'", $refused['name.collision']);
    }

    public function testFormsAbsentFromTheReferenceWaitForAConsumerAfterOneZero(): void
    {
        $document = ReferenceContract::withOperation('getTask', static function (\stdClass $operation): void {
            $operation->upstream = ['billing'];
            self::firstOf($operation->scopes)->source = (object) ['in' => 'query', 'name' => 'channel'];
        });

        $refused = self::refused($document);

        self::assertStringContainsString(self::AFTER_ONE_ZERO, $refused['upstream.unsupported'] ?? '');
        self::assertStringContainsString(self::AFTER_ONE_ZERO, $refused['scope.source.unsupported'] ?? '');
    }

    public function testAListResponseWaitsForAConsumerAfterOneZero(): void
    {
        $document = ReferenceContract::withOperation('getTask', static function (\stdClass $operation): void {
            $response = self::firstOf($operation->responses);
            $response->shape = 'list';
            $response->body = (object) ['kind' => 'array', 'items' => $response->body];
        });

        $refused = self::refused($document);

        self::assertArrayNotHasKey('ir.value.unknown', $refused);
        self::assertStringContainsString(self::AFTER_ONE_ZERO, $refused['response.shape.unsupported'] ?? '');
    }

    public function testAnIntegerStepBeyondThePhpIntRangeIsRefusedByName(): void
    {
        $document = ReferenceContract::withOperation('getTask', static function (\stdClass $operation): void {
            self::object($operation->params)->query = [
                self::param('page', false, ['kind' => 'scalar', 'type' => 'integer', 'refinements' => ['multipleOf' => '100000000000000000000']]),
            ];
        });

        self::assertStringContainsString('waits for a consumer after 1.0', self::refused($document)['multipleOf.wide.unsupported'] ?? '');
    }

    public function testBootCheckHooksWarnWaitsForAConsumer(): void
    {
        $refused = self::refused(ReferenceContract::document(ReferenceContract::TASKS), ['bootCheck' => (object) ['hooks' => 'warn']]);

        self::assertStringContainsString('it waits for an app that needs it', $refused['artefacts.bootCheck.hooks.warn.unsupported'] ?? '');
    }

    public function testEachRefusalOfTheFullReferenceNamesTheReleaseThatBringsIt(): void
    {
        $refused = self::refused(ReferenceContract::document(ReferenceContract::TASKS), ['accessHooks' => false]);

        self::assertStringContainsString('laravel-3 generates it', $refused['type.opaque.unsupported'] ?? '');
        self::assertStringContainsString('laravel-3 generates it', $refused['cache.unsupported'] ?? '');
        self::assertStringContainsString('laravel-4 generates it', $refused['artefacts.accessHooks.unsupported'] ?? '');
    }

    /**
     * Each refusal code and the message of its first place.
     *
     * @param array<string, mixed> $artefacts
     * @return array<string, string>
     */
    private static function refused(\stdClass $document, array $artefacts = []): array
    {
        try {
            (new LaravelGenerator())->generate(ReferenceContract::read(new LaravelGenerator(), $document), ReferenceContract::entry(LaravelGenerator::PACKAGE, 'tasks', 'App\\Tasks', [], $artefacts));
        } catch (GenerationRefusedException $refused) {
            $messages = [];
            foreach ($refused->problems as $problem) {
                $messages[$problem->code] ??= $problem->message;
            }

            return $messages;
        }

        self::fail('The contract was generated, but a form in it should be refused.');
    }

    private static function object(mixed $value): \stdClass
    {
        self::assertInstanceOf(\stdClass::class, $value);

        return $value;
    }

    private static function firstOf(mixed $list): \stdClass
    {
        self::assertIsArray($list);

        return self::object($list[0] ?? null);
    }

    /** @param array<string, mixed> $type */
    private static function param(string $name, bool $required, array $type): \stdClass
    {
        return (object) [
            'name' => $name,
            'origin' => (object) ['layer' => 'api', 'pointer' => '/surfaces/app/query/' . $name],
            'required' => $required,
            'type' => json_decode(json_encode($type, JSON_THROW_ON_ERROR), false, 512, JSON_THROW_ON_ERROR),
        ];
    }
}
