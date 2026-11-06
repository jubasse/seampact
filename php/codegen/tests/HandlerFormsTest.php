<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\HandlerForms;
use Seampact\Codegen\KeptForms;
use Seampact\Codegen\Refusals;
use Seampact\Codegen\Tests\Support\FixedReleases;
use Seampact\Codegen\Tests\Support\ReferenceIr;
use Seampact\Ir\Run\GenerationRefusedException;

/**
 * The forms the generated boundary leaves to the handler, which both PHP targets name with a warning: the reference
 * `tasksService` identity declares request headers (`actorSurface`, `deadline`, `trace`), so each of its operations
 * warns. An identity header written on a response is refused by name instead, on both targets alike.
 */
final class HandlerFormsTest extends TestCase
{
    public function testAnIdentityWithHeadersWarnsByNameOnEachOperationThatUsesIt(): void
    {
        $document = ReferenceIr::document('tasksService');
        $operations = is_array($document->operations) ? $document->operations : [];
        $getTaskIndex = array_search('getTask', array_map(static fn (mixed $operation): mixed => $operation instanceof \stdClass ? $operation->id : null, $operations), true);

        $warnings = HandlerForms::warnings(ReferenceIr::read($document), 'server', 'tasksService');
        $getTask = array_values(array_filter($warnings, static fn ($warning): bool => str_contains((string) $warning->where, "(operation 'getTask')")));

        self::assertSame([HandlerForms::IDENTITY_HEADERS_HANDLER], array_values(array_unique(array_map(static fn ($warning): string => $warning->code, $warnings))));
        self::assertCount(1, $getTask);
        self::assertSame("entry 'server' api 'tasksService' /operations/{$getTaskIndex}/access (operation 'getTask')", $getTask[0]->where);
        self::assertStringContainsString('is not enforced by the generated boundary', $getTask[0]->message);
        self::assertSame('Read the identity headers the boundary validated in the handler.', $getTask[0]->fix);
    }

    public function testAnIdentityWithoutHeadersDoesNotWarn(): void
    {
        self::assertSame([], HandlerForms::warnings(ReferenceIr::read(ReferenceIr::document()), 'server', 'tasks'));
    }

    public function testAnIdentityHeaderWrittenOnAResponseIsRefusedByNameAtItsDeclaration(): void
    {
        $document = ReferenceIr::keeping(self::withResponseHeaders(ReferenceIr::document('tasksService')), ['getTask']);
        $refusals = new Refusals('server', 'test', 'seampact/test');

        new KeptForms(ReferenceIr::read($document), $refusals, new FixedReleases(null));

        try {
            $refusals->throwIfAny();
            self::fail('A response-side identity header was not refused.');
        } catch (GenerationRefusedException $refused) {
            $problems = [];
            foreach ($refused->problems as $problem) {
                $problems[(string) $problem->where] = $problem;
            }

            self::assertSame(["entry 'server' /headers/trace (operation 'getTask')", "entry 'server' /headers/rightsVersion (operation 'getTask')"], array_keys($problems));
            foreach ($problems as $problem) {
                self::assertSame('identity.response.header.unsupported', $problem->code);
            }
            self::assertStringContainsString("The response header 'X-Rights-Version' of the identity 'service'", $problems["entry 'server' /headers/rightsVersion (operation 'getTask')"]->message);
        }
    }

    public function testAResponseHeaderWhoseForExcludesAnOperationIsNotRefusedOnIt(): void
    {
        $document = ReferenceIr::keeping(ReferenceIr::document('tasksService'), ['getTask']);
        self::object(self::object($document->headers)->trace)->in = 'response';
        $service = self::object(self::object($document->identities)->service);
        self::assertIsArray($service->headers);
        foreach ($service->headers as $use) {
            $traceUse = self::object($use);
            if ($traceUse->header === 'trace') {
                $traceUse->for = 'writes';
            }
        }
        $refusals = new Refusals('server', 'test', 'seampact/test');

        new KeptForms(ReferenceIr::read($document), $refusals, new FixedReleases(null));

        $refusals->throwIfAny();
        $this->addToAssertionCount(1);
    }

    public function testAnIdentityWithOnlyResponseHeadersDoesNotWarn(): void
    {
        $document = ReferenceIr::document('tasksService');
        foreach (get_object_vars(self::object($document->headers)) as $declaration) {
            self::object($declaration)->in = 'response';
        }

        self::assertSame([], HandlerForms::warnings(ReferenceIr::read($document), 'server', 'tasksService'));
    }

    // The `trace` header moved to the response, and a rights-version header on the `service` identity.
    private static function withResponseHeaders(\stdClass $document): \stdClass
    {
        $headers = self::object($document->headers);
        self::object($headers->trace)->in = 'response';
        $headers->rightsVersion = (object) [
            'id' => 'rightsVersion',
            'semantic' => 'versionToken',
            'response' => 'X-Rights-Version',
            'request' => 'If-Rights-Version',
            'origin' => (object) ['layer' => 'shared', 'pointer' => '/headers/rightsVersion'],
        ];
        $service = self::object(self::object($document->identities)->service);
        self::assertIsArray($service->headers);
        $service->headers[] = (object) [
            'header' => 'rightsVersion',
            'for' => 'writes',
            'required' => false,
            'origin' => (object) ['layer' => 'shared', 'pointer' => '/identities/service/headers/rightsVersion'],
        ];

        return $document;
    }

    private static function object(mixed $value): \stdClass
    {
        self::assertInstanceOf(\stdClass::class, $value);

        return $value;
    }
}
