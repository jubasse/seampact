<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\FormArrival;
use Seampact\Codegen\KeptForms;
use Seampact\Codegen\Refusals;
use Seampact\Codegen\Tests\Support\FixedReleases;
use Seampact\Codegen\Tests\Support\ReferenceIr;
use Seampact\Ir\Run\GenerationRefusedException;

final class KeptFormsTest extends TestCase
{
    public function testAPendingFormTheTargetGeneratesIsNotRefused(): void
    {
        $refusals = new Refusals('server', 'test', 'seampact/test');
        $kept = new KeptForms(ReferenceIr::read(ReferenceIr::keeping(ReferenceIr::document(), ['listChannels'])), $refusals, new FixedReleases(null));

        self::assertTrue($refusals->isEmpty());
        self::assertCount(1, $kept->operations());
    }

    public function testAPendingFormIsRefusedWithTheReleaseTheTargetNames(): void
    {
        $messages = self::refused(ReferenceIr::keeping(ReferenceIr::document(), ['listChannels']), FormArrival::inRelease('symfony-2'));

        self::assertStringContainsString('symfony-2 generates it', $messages['paging.unsupported'] ?? '');
        self::assertStringContainsString('symfony-2 generates it', $messages['response.shape.unsupported'] ?? '');
    }

    public function testAFormAbsentFromTheReferenceWaitsForAConsumerAfterOneZeroOnEveryTarget(): void
    {
        $document = ReferenceIr::keeping(ReferenceIr::document(), ['getTask']);
        $operation = is_array($document->operations) ? $document->operations[0] : null;
        self::assertInstanceOf(\stdClass::class, $operation);
        $operation->upstream = ['billing'];
        $operation->principalRequires = [(object) ['field' => 'verified', 'origin' => (object) ['layer' => 'api', 'pointer' => '/principalRequires/0']]];

        $messages = self::refused($document, null);

        self::assertStringContainsString('waits for a consumer after 1.0', $messages['upstream.unsupported'] ?? '');
        self::assertArrayHasKey('principalRequires.unsupported', $messages);
    }

    public function testTheSchemasEnumsAndErrorsOfTheKeptOperationsAreCollected(): void
    {
        $refusals = new Refusals('server', 'test', 'seampact/test');
        $kept = new KeptForms(ReferenceIr::read(ReferenceIr::keeping(ReferenceIr::document(), ['getTask'])), $refusals, new FixedReleases(null));

        self::assertArrayHasKey('Task', $kept->objects());
        self::assertArrayHasKey('TaskState', $kept->enums());
        self::assertNotSame([], $kept->errors());
        self::assertSame(array_keys($kept->objects()), array_values(array_unique(array_keys($kept->objects()))));
    }

    public function testTheCredentialHeadersNeverReachTheHandler(): void
    {
        $ir = ReferenceIr::read(ReferenceIr::keeping(ReferenceIr::document(), ['getTasksBatch']));

        self::assertNotSame([], $ir->operations[0]->params->header);
        self::assertSame([], KeptForms::handlerHeaders($ir->operations[0]));
    }

    /** @return array<string, string> each refusal code and its first message */
    private static function refused(\stdClass $document, ?FormArrival $arrival): array
    {
        $refusals = new Refusals('server', 'test', 'seampact/test');
        new KeptForms(ReferenceIr::read($document), $refusals, new FixedReleases($arrival));

        try {
            $refusals->throwIfAny();
        } catch (GenerationRefusedException $refused) {
            $messages = [];
            foreach ($refused->problems as $problem) {
                $messages[$problem->code] ??= $problem->message;
            }

            return $messages;
        }

        self::fail('Nothing was refused.');
    }
}
