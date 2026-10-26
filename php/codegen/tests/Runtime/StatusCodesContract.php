<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

/** A generated contract class whose operations declare codes by role and by status, with and without required params. */
final class StatusCodesContract
{
    public const API = 'tasks';
    public const IR = [
        'formats' => ['problem' => ['error' => [
            'media' => 'application/problem+json',
            'body' => ['kind' => 'object', 'members' => [['name' => ['kind' => 'text', 'text' => 'code'], 'value' => ['kind' => 'slot', 'path' => [], 'slot' => 'code']]]],
        ]]],
        'errors' => [
            'api.not_found' => ['http' => ['status' => 404], 'default' => 'notFound'],
            'tasks.missing' => ['http' => ['status' => 404]],
            'tasks.teapot' => ['http' => ['status' => 418]],
            'tasks.other_teapot' => ['http' => ['status' => 418]],
            'tasks.conflict' => ['http' => ['status' => 409], 'params' => 'ConflictParams'],
            'tasks.hint' => ['http' => ['status' => 422], 'params' => 'HintParams'],
        ],
        'schemas' => [
            'ConflictParams' => ['kind' => 'object', 'properties' => [['name' => 'version', 'optional' => false]]],
            'HintParams' => ['kind' => 'object', 'properties' => [['name' => 'hint', 'optional' => true]]],
        ],
        'operations' => [
            ['id' => 'byRole', 'errors' => [['code' => 'api.not_found'], ['code' => 'tasks.missing']]],
            ['id' => 'byStatus', 'errors' => [['code' => 'tasks.missing'], ['code' => 'tasks.teapot'], ['code' => 'tasks.hint']]],
            ['id' => 'ambiguous', 'errors' => [['code' => 'tasks.teapot'], ['code' => 'tasks.other_teapot'], ['code' => 'tasks.conflict']]],
        ],
    ];
    public const TYPES = [];
    public const ROUTES_CLASS = SelectionRoutes::class;
    public const FRAMEWORK_ROUTES = [];
}
