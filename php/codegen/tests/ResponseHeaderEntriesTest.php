<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\KeptForms;
use Seampact\Codegen\Refusals;
use Seampact\Codegen\ResponseHeaderEntries;
use Seampact\Codegen\Tests\Support\FixedReleases;
use Seampact\Codegen\Tests\Support\ReferenceIr;
use Seampact\Ir\Run\GenerationRefusedException;

/**
 * The response headers the generator hands the boundary: a deprecated operation's dates and successor link, and the
 * version ETag of a resource versioned by `If-Match`, its field found through the writes; what it cannot write is
 * refused by name, a structured page header too.
 */
final class ResponseHeaderEntriesTest extends TestCase
{
    private const RESOURCE = '/surfaces/app/routes/channels/member/routes/tasks/concurrency';

    public function testADeprecatedReadAndAnIfMatchWriteGetTheirHeaders(): void
    {
        $refusals = new Refusals('server', 'test', 'seampact/test');
        $kept = new KeptForms(ReferenceIr::read(self::versioned('tasks', self::RESOURCE)), $refusals, new FixedReleases(null));

        self::assertTrue($refusals->isEmpty());
        self::assertSame([200 => [
            ['kind' => 'entityTag', 'name' => 'ETag', 'field' => 'version'],
            ['kind' => 'text', 'name' => 'Deprecation', 'value' => '@1798675200'],
            ['kind' => 'text', 'name' => 'Sunset', 'value' => 'Wed, 30 Jun 2027 00:00:00 GMT'],
            ['kind' => 'successorLink', 'name' => 'Link', 'path' => '/v1/channels/{channelId}/tasks/{taskId}', 'rel' => 'successor-version'],
        ]], $kept->responseHeaders('getTask'));
        self::assertSame([200 => [['kind' => 'entityTag', 'name' => 'ETag', 'field' => 'version']]], $kept->responseHeaders('updateTask'));
    }

    public function testAnEtagNoIfMatchWriteVersionsIsRefusedByName(): void
    {
        $messages = self::refused(self::versioned('tasks', '/surfaces/app/routes/channels/concurrency'));

        self::assertArrayHasKey('concurrency.etag.withoutWrite.unsupported', $messages);
    }

    public function testASuccessorInAnotherApiIsRefusedByName(): void
    {
        $messages = self::refused(self::versioned('billing', self::RESOURCE));

        self::assertStringContainsString("operation 'updateTask' of api 'billing'", $messages['deprecated.successor.otherApi.unsupported'] ?? '');
    }

    public function testAPageHeaderWrittenFromAnObjectIsRefusedByName(): void
    {
        $document = ReferenceIr::keeping(ReferenceIr::document(), ['listTasks']);
        $styleResponse = self::object(self::object(self::object($document->pagings)->cursor)->response);
        $styleResponse->headers = [(object) ['name' => 'X-Page-Meta', 'value' => (object) ['kind' => 'slot', 'slot' => 'meta', 'path' => []]]];

        $messages = self::refused($document);

        self::assertStringContainsString("The header 'X-Page-Meta' of the paging style 'cursor', written from an object or an array,", $messages['paging.response.header.unsupported'] ?? '');
    }

    public function testTheDatesAreWrittenFromTheirFieldsWhateverTheYear(): void
    {
        self::assertSame('@1798675200', ResponseHeaderEntries::deprecationValue('2026-12-31'));
        self::assertSame('Thu, 01 Jan 0099 00:00:00 GMT', ResponseHeaderEntries::sunsetValue('0099-01-01'));
        self::assertNull(ResponseHeaderEntries::sunsetValue('2027-02-30'));
    }

    // `getTask` deprecated in favour of `updateTask` of `$successorApi`, which `If-Match` versions; the read's ETag is
    // derived from `$etagOrigin`.
    private static function versioned(string $successorApi, string $etagOrigin): \stdClass
    {
        $document = ReferenceIr::keeping(ReferenceIr::document(), ['getTask', 'updateTask']);
        $read = self::operation($document, 'getTask');
        $write = self::operation($document, 'updateTask');

        self::object($write->concurrency)->version = (object) ['in' => 'header', 'name' => 'If-Match'];
        $writeResponse = self::firstResponse($write);
        $writeResponse->headers = [...(is_array($writeResponse->headers) ? $writeResponse->headers : []), self::header('ETag', null, 'concurrency.version', self::RESOURCE)];

        $read->deprecated = (object) [
            'since' => '2026-12-31',
            'sunset' => '2027-06-30',
            'successor' => (object) ['kind' => 'httpOperation', 'api' => $successorApi, 'id' => 'updateTask'],
            'successorRel' => 'successor-version',
            'origin' => (object) ['layer' => 'api', 'pointer' => '/deprecated'],
        ];
        self::firstResponse($read)->headers = [
            self::header('ETag', null, 'concurrency.version', $etagOrigin),
            self::header('Deprecation', 'deprecation', 'deprecation.headers', '/deprecated'),
            self::header('Sunset', 'sunset', 'deprecation.headers', '/deprecated'),
            self::header('Link', 'successorLink', 'deprecation.headers', '/deprecated'),
        ];

        return $document;
    }

    private static function operation(\stdClass $document, string $operationId): \stdClass
    {
        foreach (is_array($document->operations) ? $document->operations : [] as $operation) {
            $candidate = self::object($operation);
            if ($candidate->id === $operationId) {
                return $candidate;
            }
        }

        self::fail("The reference IR has no operation '{$operationId}'.");
    }

    private static function firstResponse(\stdClass $operation): \stdClass
    {
        return self::object(is_array($operation->responses) ? $operation->responses[0] : null);
    }

    private static function object(mixed $node): \stdClass
    {
        self::assertInstanceOf(\stdClass::class, $node);

        return $node;
    }

    private static function header(string $name, ?string $semantic, string $derivation, string $from): \stdClass
    {
        $header = (object) [
            'name' => $name,
            'type' => (object) ['kind' => 'scalar', 'type' => 'string', 'refinements' => new \stdClass()],
            'required' => true,
            'derivedFrom' => (object) ['derivation' => $derivation, 'from' => [(object) ['layer' => 'api', 'pointer' => $from]]],
        ];
        if ($semantic !== null) {
            $header->semantic = $semantic;
        }

        return $header;
    }

    /** @return array<string, string> each refused code and its first message */
    private static function refused(\stdClass $document): array
    {
        $refusals = new Refusals('server', 'test', 'seampact/test');
        new KeptForms(ReferenceIr::read($document), $refusals, new FixedReleases(null));

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
