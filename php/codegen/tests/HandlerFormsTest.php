<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\HandlerForms;
use Seampact\Codegen\Tests\Support\ReferenceIr;

/**
 * The forms the generated boundary leaves to the handler, which both PHP targets name with a warning: the reference
 * `tasksService` identity declares headers (`actorSurface`, `deadline`, `trace`), so each of its operations warns.
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
}
