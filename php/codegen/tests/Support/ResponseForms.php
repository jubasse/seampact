<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Support;

/**
 * The response forms 1.0 refuses by name (CHK-022, 024, 027, 153), each put in the reference tasks IR by editing one
 * operation: a response header the route writes itself, a union, a redirect response and a degradable operation;
 * shared by the PHP targets' refusal tests.
 */
final class ResponseForms
{
    private const UNION_ID = 'TaskUnion';

    private function __construct()
    {
    }

    /** `getTask`, its 200 carrying a header with no derivation, which the route would write itself. */
    public static function withRouteWrittenHeader(): \stdClass
    {
        return ReferenceContract::withOperation('getTask', static function (\stdClass $operation): void {
            $response = self::firstResponseOf($operation);
            $headers = is_array($response->headers ?? null) ? $response->headers : [];
            $headers[] = (object) [
                'name' => 'X-Route-Note',
                'type' => (object) ['kind' => 'scalar', 'type' => 'string', 'refinements' => (object) []],
                'required' => true,
            ];
            $response->headers = $headers;
        });
    }

    /** `getTask`, its 200 answering a union of its body schema, tagged by a header. */
    public static function withUnionAnswer(): \stdClass
    {
        return ReferenceContract::withOperation('getTask', static function (\stdClass $operation, \stdClass $document): void {
            $response = self::firstResponseOf($operation);
            $body = $response->body ?? null;
            if (!$body instanceof \stdClass || !$document->schemas instanceof \stdClass) {
                throw new \LogicException('The reference getTask answers no schema reference.');
            }

            $document->schemas->{self::UNION_ID} = (object) [
                'kind' => 'union',
                'id' => self::UNION_ID,
                'name' => (object) ['segments' => ['task', 'union'], 'role' => 'schema'],
                'directions' => ['output'],
                'examples' => [],
                'docs' => (object) [],
                'extensions' => (object) [],
                'origin' => (object) ['layer' => 'api', 'pointer' => '/schemas/' . self::UNION_ID],
                'tag' => (object) ['in' => 'header', 'name' => 'X-Task-Kind'],
                'variants' => [(object) ['schema' => $body->schema, 'tag' => 'first'], (object) ['schema' => $body->schema, 'tag' => 'second']],
            ];
            $response->body = (object) ['kind' => 'ref', 'schema' => self::UNION_ID];
        });
    }

    /** `getTask`, its 200 turned into a redirect. */
    public static function withRedirectAnswer(): \stdClass
    {
        return ReferenceContract::withOperation('getTask', static function (\stdClass $operation): void {
            $response = self::firstResponseOf($operation);
            $response->shape = 'redirect';
            unset($response->body, $response->media);
        });
    }

    /** `searchTasks`, degradable on its items. */
    public static function withDegradableOperation(): \stdClass
    {
        return ReferenceContract::withOperation('searchTasks', static function (\stdClass $operation): void {
            $operation->degradable = (object) ['paths' => ['/items'], 'header' => 'X-Degraded', 'origin' => (object) ['layer' => 'api', 'pointer' => '/degradable']];
        });
    }

    private static function firstResponseOf(\stdClass $operation): \stdClass
    {
        $response = is_array($operation->responses) ? ($operation->responses[0] ?? null) : null;
        if (!$response instanceof \stdClass) {
            throw new \LogicException('The reference operation has no response.');
        }

        return $response;
    }
}
