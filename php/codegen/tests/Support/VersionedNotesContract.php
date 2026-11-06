<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Support;

use Seampact\Codegen\Runtime\RuntimeVersion;

/**
 * A generated contract class whose notes are versioned by `If-Match` and whose legacy routes are deprecated, with the
 * response header entries the generator derives for them.
 */
final class VersionedNotesContract
{
    public const API = 'notes';
    public const GENERATED_BY = RuntimeVersion::VERSION;
    private const OPAQUE = ['kind' => 'opaque', 'reason' => 'a note'];
    private const NOTE_ID = ['name' => 'noteId', 'required' => true, 'type' => ['kind' => 'scalar', 'type' => 'string']];
    private const DEPRECATED = ['since' => '2026-12-31', 'sunset' => '2027-06-30', 'successor' => ['kind' => 'httpOperation', 'api' => 'notes', 'id' => 'updateNote'], 'successorRel' => 'successor-version'];
    private const DEPRECATION_HEADERS = [
        ['kind' => 'text', 'name' => 'Deprecation', 'value' => '@1798675200'],
        ['kind' => 'text', 'name' => 'Sunset', 'value' => 'Wed, 30 Jun 2027 00:00:00 GMT'],
    ];
    private const SUCCESSOR_LINK = ['kind' => 'successorLink', 'name' => 'Link', 'path' => '/v1/notes/{noteId}', 'rel' => 'successor-version'];
    private const ENTITY_TAG = ['kind' => 'entityTag', 'name' => 'ETag', 'field' => 'revision'];
    public const IR = [
        'formats' => ['bare' => [
            'absent' => 'omit',
            'success' => ['item' => ['body' => ['kind' => 'slot', 'slot' => 'payload', 'path' => []]]],
            'error' => ['media' => 'application/json', 'body' => ['kind' => 'object', 'members' => [['name' => ['kind' => 'text', 'text' => 'code'], 'value' => ['kind' => 'slot', 'path' => [], 'slot' => 'code']]]]],
        ]],
        'errors' => [
            'api.precondition_required' => ['http' => ['status' => 428]],
            'api.precondition_failed' => ['http' => ['status' => 412]],
            'api.schema_invalid' => ['http' => ['status' => 400]],
        ],
        'operations' => [
            [
                'id' => 'legacyNote', 'method' => 'get', 'path' => '/v1/notes/{noteId}/legacy', 'format' => 'bare',
                'params' => ['path' => [self::NOTE_ID], 'query' => [], 'header' => []],
                'responses' => [['status' => 200, 'shape' => 'item', 'body' => self::OPAQUE]],
                'deprecated' => self::DEPRECATED,
                'cache' => ['etag' => true, 'perCallerKind' => []],
            ],
            [
                'id' => 'updateNote', 'method' => 'patch', 'path' => '/v1/notes/{noteId}', 'format' => 'bare',
                'params' => ['path' => [self::NOTE_ID], 'query' => [], 'header' => [['name' => 'If-Match', 'required' => true, 'type' => ['kind' => 'scalar', 'type' => 'string']]]],
                'concurrency' => ['version' => ['in' => 'header', 'name' => 'If-Match'], 'field' => 'revision'],
                'responses' => [['status' => 200, 'shape' => 'item', 'body' => self::OPAQUE]],
                'errors' => [
                    ['code' => 'api.precondition_required', 'roles' => [['role' => 'preconditionRequired']]],
                    ['code' => 'api.precondition_failed', 'roles' => [['role' => 'preconditionFailed']]],
                    ['code' => 'api.schema_invalid', 'roles' => [['role' => 'schemaInvalid']]],
                ],
            ],
            [
                'id' => 'purgeNote', 'method' => 'delete', 'path' => '/v1/notes/{noteId}/legacy', 'format' => 'bare',
                'params' => ['path' => [self::NOTE_ID], 'query' => [], 'header' => []],
                'responses' => [['status' => 204, 'shape' => 'empty']],
                'deprecated' => self::DEPRECATED,
            ],
        ],
    ];
    public const TYPES = ['operations' => [
        'legacyNote' => ['responses' => [200 => LegacyNoteReply::class], 'responseHeaders' => [200 => [self::ENTITY_TAG, ...self::DEPRECATION_HEADERS, self::SUCCESSOR_LINK]]],
        'updateNote' => [
            'input' => UpdateNoteInput::class,
            'parts' => ['headers' => ['class' => UpdateNoteHeaders::class, 'members' => ['If-Match' => 'ifMatch']]],
            'responses' => [200 => UpdatedNoteReply::class],
            'responseHeaders' => [200 => [self::ENTITY_TAG]],
        ],
        'purgeNote' => ['responses' => [204 => \stdClass::class], 'responseHeaders' => [204 => self::DEPRECATION_HEADERS]],
    ]];
    public const ROUTES_CLASS = VersionedNotesRoutes::class;
    public const FRAMEWORK_ROUTES = [];
    public const FRAMEWORK_ROUTE_SCOPE = 'contract';
    public const MOUNT = '/api';
}
