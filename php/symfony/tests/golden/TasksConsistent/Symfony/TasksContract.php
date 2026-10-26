<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony;

/**
 * The contract of api 'tasks' as its boundary reads it.
 */
final class TasksContract
{
  public const API = 'tasks';
  public const ROUTES_CLASS = 'Seampact\Golden\TasksConsistent\Symfony\TasksRouteLoader';

  /** The IR of the kept operations and the declarations the boundary reads. */
  public const IR = [
    'api' => [
      'id' => 'tasks',
      'name' => ['segments' => ['tasks'], 'role' => 'schema'],
      'version' => ['kind' => 'path', 'number' => 1],
      'kind' => 'product',
      'pathVersion' => ['value' => 'prefix', 'origin' => ['layer' => 'api', 'pointer' => '/api/version']],
      'maturity' => 'provisional',
      'compat' => ['policy' => 'additive-only'],
      'wire' => ['int64' => 'string', 'outputEnums' => 'enum', 'urls' => 'relative'],
      'surfaces' => [
        'app' => [
          'name' => ['segments' => ['app'], 'role' => 'schema'],
          'prefix' => '/v1',
          'pathVersion' => 'prefix',
          'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app'],
        ],
        'hooks' => [
          'name' => ['segments' => ['hooks'], 'role' => 'schema'],
          'prefix' => '/v1/hooks',
          'pathVersion' => 'prefix',
          'origin' => ['layer' => 'api', 'pointer' => '/surfaces/hooks'],
        ],
      ],
      'documents' => [
        'full' => ['surfaces' => ['app', 'hooks'], 'internal' => 'include'],
        'public' => ['surfaces' => ['app'], 'internal' => 'exclude'],
      ],
      'docs' => ['summary' => 'Tasks shared inside channels.'],
      'extensions' => [],
      'origin' => ['layer' => 'api', 'pointer' => '/api'],
    ],
    'errors' => [
      'api.csrf_invalid' => [
        'code' => 'api.csrf_invalid',
        'family' => 'api',
        'nature' => 'refused',
        'http' => ['status' => 403],
        'docs' => [],
        'origin' => ['layer' => 'core', 'pointer' => '/errors/api.csrf_invalid'],
        'default' => 'csrfInvalid',
      ],
      'api.forbidden' => [
        'code' => 'api.forbidden',
        'family' => 'api',
        'nature' => 'refused',
        'http' => ['status' => 403],
        'params' => 'ApiForbiddenParams',
        'docs' => [],
        'origin' => ['layer' => 'core', 'pointer' => '/errors/api.forbidden'],
        'default' => 'forbidden',
      ],
      'api.idempotency_in_progress' => [
        'code' => 'api.idempotency_in_progress',
        'family' => 'api',
        'nature' => 'unavailable',
        'http' => ['status' => 409],
        'docs' => [],
        'origin' => ['layer' => 'core', 'pointer' => '/errors/api.idempotency_in_progress'],
        'default' => 'idempotencyInProgress',
      ],
      'api.idempotency_key_reused' => [
        'code' => 'api.idempotency_key_reused',
        'family' => 'api',
        'nature' => 'refused',
        'http' => ['status' => 422],
        'docs' => [],
        'origin' => ['layer' => 'core', 'pointer' => '/errors/api.idempotency_key_reused'],
        'default' => 'idempotencyKeyReused',
      ],
      'api.internal' => [
        'code' => 'api.internal',
        'family' => 'api',
        'nature' => 'failed',
        'http' => ['status' => 500],
        'docs' => [],
        'origin' => ['layer' => 'core', 'pointer' => '/errors/api.internal'],
        'default' => 'undeclaredStatus',
      ],
      'api.not_found' => [
        'code' => 'api.not_found',
        'family' => 'api',
        'nature' => 'refused',
        'http' => ['status' => 404],
        'docs' => [],
        'origin' => ['layer' => 'core', 'pointer' => '/errors/api.not_found'],
        'default' => 'notFound',
      ],
      'api.payload_too_large' => [
        'code' => 'api.payload_too_large',
        'family' => 'api',
        'nature' => 'refused',
        'http' => ['status' => 413],
        'params' => 'ApiPayloadTooLargeParams',
        'docs' => [],
        'origin' => ['layer' => 'core', 'pointer' => '/errors/api.payload_too_large'],
        'default' => 'payloadTooLarge',
      ],
      'api.rate_limited' => [
        'code' => 'api.rate_limited',
        'family' => 'api',
        'nature' => 'unavailable',
        'http' => ['status' => 429],
        'params' => 'ApiRateLimitedParams',
        'example' => ['retryAfterMs' => 1500],
        'docs' => [],
        'origin' => ['layer' => 'shared', 'pointer' => '/errors/api.rate_limited'],
        'default' => 'rateLimited',
      ],
      'api.reauthentication_required' => [
        'code' => 'api.reauthentication_required',
        'family' => 'api',
        'nature' => 'refused',
        'http' => ['status' => 401],
        'docs' => [],
        'origin' => ['layer' => 'shared', 'pointer' => '/errors/api.reauthentication_required'],
      ],
      'api.schema_invalid' => [
        'code' => 'api.schema_invalid',
        'family' => 'api',
        'nature' => 'refused',
        'http' => ['status' => 400],
        'params' => 'ApiSchemaInvalidParams',
        'example' => ['issues' => [['pointer' => '/title', 'rule' => 'minLength']]],
        'docs' => [],
        'origin' => ['layer' => 'shared', 'pointer' => '/errors/api.schema_invalid'],
        'default' => 'schemaInvalid',
      ],
      'api.unauthenticated' => [
        'code' => 'api.unauthenticated',
        'family' => 'api',
        'nature' => 'refused',
        'http' => ['status' => 401],
        'docs' => [],
        'origin' => ['layer' => 'core', 'pointer' => '/errors/api.unauthenticated'],
        'default' => 'unauthenticated',
      ],
      'api.unsupported_media_type' => [
        'code' => 'api.unsupported_media_type',
        'family' => 'api',
        'nature' => 'refused',
        'http' => ['status' => 415],
        'docs' => [],
        'origin' => ['layer' => 'core', 'pointer' => '/errors/api.unsupported_media_type'],
        'default' => 'unsupportedMediaType',
      ],
      'state.conflict' => [
        'code' => 'state.conflict',
        'family' => 'state',
        'nature' => 'refused',
        'http' => ['status' => 409],
        'docs' => [],
        'origin' => ['layer' => 'core', 'pointer' => '/errors/state.conflict'],
        'default' => 'stateConflict',
      ],
    ],
    'formats' => [
      'bare' => [
        'id' => 'bare',
        'origin' => ['layer' => 'core', 'pointer' => '/formats/bare'],
        'media' => 'application/json',
        'absent' => 'omit',
        'success' => [
          'item' => ['body' => ['kind' => 'slot', 'slot' => 'payload', 'path' => []], 'headers' => []],
          'table' => ['body' => ['kind' => 'slot', 'slot' => 'payload', 'path' => []], 'headers' => []],
          'list' => ['body' => ['kind' => 'slot', 'slot' => 'payload', 'path' => []], 'headers' => []],
          'page' => ['body' => ['kind' => 'slot', 'slot' => 'items', 'path' => []], 'headers' => []],
        ],
        'meta' => [],
        'error' => [
          'media' => 'application/problem+json',
          'body' => [
            'kind' => 'object',
            'members' => [
              [
                'name' => ['kind' => 'text', 'text' => 'type'],
                'value' => ['kind' => 'slot', 'slot' => 'code', 'path' => []],
              ],
              [
                'name' => ['kind' => 'text', 'text' => 'title'],
                'value' => ['kind' => 'slot', 'slot' => 'title', 'path' => []],
              ],
              [
                'name' => ['kind' => 'text', 'text' => 'status'],
                'value' => ['kind' => 'slot', 'slot' => 'status', 'path' => []],
              ],
              [
                'name' => ['kind' => 'text', 'text' => 'detail'],
                'value' => ['kind' => 'slot', 'slot' => 'detail', 'path' => []],
              ],
              [
                'name' => ['kind' => 'text', 'text' => 'instance'],
                'value' => ['kind' => 'slot', 'slot' => 'instance', 'path' => []],
              ],
              [
                'name' => ['kind' => 'text', 'text' => 'code'],
                'value' => ['kind' => 'slot', 'slot' => 'code', 'path' => []],
              ],
              [
                'name' => ['kind' => 'text', 'text' => 'nature'],
                'value' => ['kind' => 'slot', 'slot' => 'nature', 'path' => []],
              ],
              [
                'name' => ['kind' => 'text', 'text' => 'traceId'],
                'value' => ['kind' => 'slot', 'slot' => 'traceId', 'path' => []],
              ],
            ],
            'merge' => 'params',
          ],
          'headers' => [],
        ],
      ],
    ],
    'identities' => [
      'service' => [
        'id' => 'service',
        'kind' => 'credential',
        'schemes' => ['read' => ['internalToken'], 'write' => ['internalToken'], 'optionalRead' => []],
        'principal' => ['kind' => 'schema', 'schema' => 'ServicePrincipal'],
        'errors' => [],
        'headers' => [
          [
            'header' => 'actorSurface',
            'for' => 'writes',
            'required' => true,
            'schema' => ['kind' => 'enum', 'enum' => 'Surface'],
            'origin' => ['layer' => 'shared', 'pointer' => '/identities/service/headers/actorSurface'],
          ],
          [
            'header' => 'deadline',
            'for' => 'all',
            'required' => true,
            'origin' => ['layer' => 'shared', 'pointer' => '/identities/service/headers/deadline'],
          ],
          [
            'header' => 'trace',
            'for' => 'all',
            'required' => false,
            'origin' => ['layer' => 'shared', 'pointer' => '/identities/service/headers/trace'],
          ],
        ],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'shared', 'pointer' => '/identities/service'],
      ],
      'stripe' => [
        'id' => 'stripe',
        'kind' => 'signed',
        'signed' => 'stripeSignature',
        'principal' => ['kind' => 'schema', 'schema' => 'WebhookCaller'],
        'errors' => [],
        'headers' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'shared', 'pointer' => '/identities/stripe'],
      ],
      'user' => [
        'id' => 'user',
        'kind' => 'credential',
        'schemes' => [
          'read' => ['bearer', 'sessionCookie'],
          'write' => ['bearer', 'sessionCookie'],
          'optionalRead' => [],
        ],
        'principal' => ['kind' => 'schema', 'schema' => 'UserPrincipal'],
        'errors' => [],
        'headers' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'shared', 'pointer' => '/identities/user'],
      ],
    ],
    'schemes' => [
      'bearer' => [
        'id' => 'bearer',
        'kind' => 'bearer',
        'origin' => ['layer' => 'shared', 'pointer' => '/schemes/bearer'],
      ],
      'csrfToken' => [
        'id' => 'csrfToken',
        'kind' => 'header',
        'name' => 'X-Csrf-Token',
        'origin' => ['layer' => 'shared', 'pointer' => '/schemes/csrfToken'],
      ],
      'internalToken' => [
        'id' => 'internalToken',
        'kind' => 'bearer',
        'bearer' => ['format' => 'jwt'],
        'origin' => ['layer' => 'shared', 'pointer' => '/schemes/internalToken'],
      ],
      'sessionCookie' => [
        'id' => 'sessionCookie',
        'kind' => 'cookie',
        'name' => '__Host-session',
        'csrf' => 'csrfToken',
        'origin' => ['layer' => 'shared', 'pointer' => '/schemes/sessionCookie'],
      ],
      'stripeSignature' => [
        'id' => 'stripeSignature',
        'kind' => 'signature',
        'name' => 'Stripe-Signature',
        'signature' => [
          'verify' => 'template',
          'format' => 't={ts},v1={sig}',
          'algorithm' => 'hmac-sha256',
          'payload' => '{ts}.{rawBody}',
          'encoding' => 'hex',
          'toleranceMs' => 300000,
          'key' => ['kind' => 'value', 'value' => 'stripe'],
        ],
        'origin' => ['layer' => 'shared', 'pointer' => '/schemes/stripeSignature'],
      ],
    ],
    'scopes' => [
      'channel' => [
        'id' => 'channel',
        'idSchema' => ['kind' => 'scalar', 'type' => 'string', 'format' => 'uuid', 'refinements' => []],
        'errors' => ['api.not_found'],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'shared', 'pointer' => '/scopes/channel'],
      ],
    ],
    'rights' => [
      'roles' => [
        'id' => 'roles',
        'params' => 'RolesParams',
        'subject' => ['kind' => 'scope', 'scope' => 'channel'],
        'errors' => ['api.forbidden'],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'shared', 'pointer' => '/rights/roles'],
      ],
      'tasks.read' => [
        'id' => 'tasks.read',
        'subject' => ['kind' => 'scope', 'scope' => 'channel'],
        'errors' => ['api.forbidden'],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'shared', 'pointer' => '/rights/tasks.read'],
      ],
      'tasks.seeEffort' => [
        'id' => 'tasks.seeEffort',
        'subject' => [
          'kind' => 'resource',
          'type' => ['segments' => ['task'], 'role' => 'schema'],
          'idSchema' => ['kind' => 'scalar', 'type' => 'string', 'format' => 'uuid', 'refinements' => []],
        ],
        'errors' => ['api.forbidden'],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'shared', 'pointer' => '/rights/tasks.seeEffort'],
      ],
      'tasks.update' => [
        'id' => 'tasks.update',
        'subject' => [
          'kind' => 'resource',
          'type' => ['segments' => ['task'], 'role' => 'schema'],
          'idSchema' => ['kind' => 'scalar', 'type' => 'string', 'format' => 'uuid', 'refinements' => []],
        ],
        'errors' => ['api.forbidden', 'api.not_found'],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'shared', 'pointer' => '/rights/tasks.update'],
      ],
    ],
    'rules' => [
      'recentAuth' => [
        'id' => 'recentAuth',
        'params' => 'RecentAuthParams',
        'takesBucket' => false,
        'proof' => [
          'in' => 'body',
          'name' => 'reauthToken',
          'schema' => [
            'kind' => 'scalar',
            'type' => 'string',
            'refinements' => ['minLength' => 1, 'maxLength' => 512],
          ],
        ],
        'errors' => ['api.reauthentication_required'],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'shared', 'pointer' => '/rules/recentAuth'],
      ],
      'throttle' => [
        'id' => 'throttle',
        'takesBucket' => true,
        'errors' => ['api.rate_limited'],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'shared', 'pointer' => '/rules/throttle'],
      ],
    ],
    'buckets' => [
      'write' => [
        'id' => 'write',
        'key' => [['in' => 'principal', 'name' => 'userId']],
        'limit' => 60,
        'windowMs' => 60000,
        'origin' => ['layer' => 'shared', 'pointer' => '/buckets/write'],
      ],
    ],
    'pagings' => [
      'cursor' => [
        'id' => 'cursor',
        'origin' => ['layer' => 'shared', 'pointer' => '/pagings/cursor'],
        'position' => 'cursor',
        'absent' => 'omit',
        'request' => [
          ['role' => 'cursor', 'in' => 'query', 'name' => 'cursor'],
          ['role' => 'limit', 'in' => 'query', 'name' => 'limit'],
          ['role' => 'sort', 'in' => 'query', 'name' => 'sort', 'style' => 'signed'],
        ],
        'response' => [
          'body' => ['kind' => 'slot', 'slot' => 'items', 'path' => []],
          'meta' => [],
          'headers' => [],
          'links' => [['rel' => 'next', 'role' => 'next']],
        ],
        'handlerResult' => ['nextCursor'],
      ],
    ],
    'schemas' => [
      'ApiEmptyBody' => [
        'kind' => 'object',
        'properties' => [],
        'id' => 'ApiEmptyBody',
        'name' => ['segments' => ['api', 'empty', 'body'], 'role' => 'schema'],
        'directions' => ['input'],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'core', 'pointer' => '/schemas/ApiEmptyBody'],
      ],
      'ApiForbiddenParams' => [
        'kind' => 'object',
        'properties' => [
          [
            'name' => 'pointer',
            'type' => ['kind' => 'scalar', 'type' => 'string', 'refinements' => []],
            'optional' => true,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'core', 'pointer' => '/errors/api.forbidden/params/pointer'],
          ],
        ],
        'id' => 'ApiForbiddenParams',
        'name' => ['segments' => ['api', 'forbidden'], 'role' => 'params'],
        'directions' => ['output'],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'core', 'pointer' => '/errors/api.forbidden/params'],
      ],
      'ApiPayloadTooLargeParams' => [
        'kind' => 'object',
        'properties' => [
          [
            'name' => 'limitBytes',
            'type' => ['kind' => 'scalar', 'type' => 'integer', 'refinements' => ['minimum' => '0']],
            'optional' => true,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'core', 'pointer' => '/errors/api.payload_too_large/params/limitBytes'],
          ],
        ],
        'id' => 'ApiPayloadTooLargeParams',
        'name' => ['segments' => ['api', 'payload', 'too', 'large'], 'role' => 'params'],
        'directions' => ['output'],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'core', 'pointer' => '/errors/api.payload_too_large/params'],
      ],
      'ApiRateLimitedParams' => [
        'kind' => 'object',
        'properties' => [
          [
            'name' => 'retryAfterMs',
            'type' => [
              'kind' => 'scalar',
              'type' => 'integer',
              'refinements' => ['minimum' => '0', 'maximum' => '9007199254740991'],
            ],
            'optional' => false,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'shared', 'pointer' => '/errors/api.rate_limited/params/retryAfterMs'],
          ],
        ],
        'id' => 'ApiRateLimitedParams',
        'name' => ['segments' => ['api', 'rate', 'limited'], 'role' => 'params'],
        'directions' => ['output'],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'shared', 'pointer' => '/errors/api.rate_limited/params'],
      ],
      'ApiSchemaInvalidParams' => [
        'kind' => 'object',
        'properties' => [
          [
            'name' => 'issues',
            'type' => ['kind' => 'array', 'items' => ['kind' => 'ref', 'schema' => 'IssuesItem']],
            'optional' => false,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'shared', 'pointer' => '/errors/api.schema_invalid/params/issues'],
          ],
        ],
        'id' => 'ApiSchemaInvalidParams',
        'name' => ['segments' => ['api', 'schema', 'invalid'], 'role' => 'params'],
        'directions' => ['output'],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'shared', 'pointer' => '/errors/api.schema_invalid/params'],
      ],
      'ArchiveTask' => [
        'kind' => 'object',
        'properties' => [
          [
            'name' => 'reason',
            'type' => [
              'kind' => 'scalar',
              'type' => 'string',
              'refinements' => ['minLength' => 1, 'maxLength' => 500],
            ],
            'optional' => false,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'api', 'pointer' => '/schemas/ArchiveTask/properties/reason'],
          ],
          [
            'name' => 'expectedVersion',
            'type' => ['kind' => 'scalar', 'type' => 'integer', 'refinements' => ['minimum' => '1']],
            'optional' => false,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => [
              'layer' => 'api',
              'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/concurrency/version',
            ],
            'derivedFrom' => [
              'derivation' => 'concurrency.version',
              'from' => [
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/concurrency/version',
                ],
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/member/routes/archive/concurrency',
                ],
              ],
            ],
          ],
        ],
        'id' => 'ArchiveTask',
        'name' => ['segments' => ['archive', 'task'], 'role' => 'schema'],
        'directions' => ['input'],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'api', 'pointer' => '/schemas/ArchiveTask'],
      ],
      'AssignTaskInput' => [
        'kind' => 'object',
        'properties' => [
          [
            'name' => 'userId',
            'type' => ['kind' => 'scalar', 'type' => 'string', 'format' => 'uuid', 'refinements' => []],
            'optional' => false,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => [
              'layer' => 'api',
              'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/member/routes/assign/input/properties/userId',
            ],
          ],
        ],
        'id' => 'AssignTaskInput',
        'name' => ['segments' => ['assign', 'task'], 'role' => 'input'],
        'directions' => ['input'],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => [
          'layer' => 'api',
          'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/member/routes/assign/input',
        ],
      ],
      'Channel' => [
        'kind' => 'object',
        'properties' => [
          [
            'name' => 'channelId',
            'type' => ['kind' => 'scalar', 'type' => 'string', 'format' => 'uuid', 'refinements' => []],
            'optional' => false,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'api', 'pointer' => '/schemas/Channel/properties/channelId'],
          ],
          [
            'name' => 'name',
            'type' => [
              'kind' => 'scalar',
              'type' => 'string',
              'refinements' => ['minLength' => 1, 'maxLength' => 100],
            ],
            'optional' => false,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'api', 'pointer' => '/schemas/Channel/properties/name'],
          ],
        ],
        'id' => 'Channel',
        'name' => ['segments' => ['channel'], 'role' => 'schema'],
        'directions' => ['output'],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'api', 'pointer' => '/schemas/Channel'],
      ],
      'CreateTask' => [
        'kind' => 'object',
        'properties' => [
          [
            'name' => 'title',
            'type' => [
              'kind' => 'scalar',
              'type' => 'string',
              'refinements' => ['minLength' => 1, 'maxLength' => 200],
            ],
            'optional' => false,
            'nullable' => false,
            'sensitive' => true,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'shared', 'pointer' => '/schemas/Task/properties/title'],
          ],
          [
            'name' => 'effort',
            'type' => ['kind' => 'scalar', 'type' => 'integer', 'refinements' => ['minimum' => '0']],
            'optional' => true,
            'nullable' => false,
            'sensitive' => false,
            'restrictedTo' => [
              'right' => 'roles',
              'params' => ['allowed' => ['owner']],
              'origin' => [
                'layer' => 'api',
                'pointer' => '/schemas/CreateTask/properties/effort/restrictedTo',
              ],
            ],
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'shared', 'pointer' => '/schemas/Task/properties/effort'],
          ],
        ],
        'id' => 'CreateTask',
        'name' => ['segments' => ['create', 'task'], 'role' => 'schema'],
        'directions' => ['input'],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'api', 'pointer' => '/schemas/CreateTask'],
      ],
      'Draft' => [
        'kind' => 'object',
        'properties' => [
          [
            'name' => 'draftId',
            'type' => ['kind' => 'scalar', 'type' => 'string', 'format' => 'uuid', 'refinements' => []],
            'optional' => false,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'api', 'pointer' => '/schemas/Draft/properties/draftId'],
          ],
          [
            'name' => 'body',
            'type' => ['kind' => 'scalar', 'type' => 'string', 'refinements' => ['maxLength' => 20000]],
            'optional' => false,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'api', 'pointer' => '/schemas/Draft/properties/body'],
          ],
        ],
        'id' => 'Draft',
        'name' => ['segments' => ['draft'], 'role' => 'schema'],
        'directions' => ['output'],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'api', 'pointer' => '/schemas/Draft'],
      ],
      'GetTasksBatchInput' => [
        'kind' => 'object',
        'properties' => [
          [
            'name' => 'ids',
            'type' => [
              'kind' => 'array',
              'items' => ['kind' => 'scalar', 'type' => 'string', 'format' => 'uuid', 'refinements' => []],
              'maxItems' => 200,
            ],
            'optional' => false,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => [
              'layer' => 'api',
              'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/batch/maxIds',
            ],
            'derivedFrom' => [
              'derivation' => 'batch.read',
              'from' => [
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/batch',
                ],
              ],
            ],
          ],
        ],
        'id' => 'GetTasksBatchInput',
        'name' => ['segments' => ['get', 'tasks', 'batch'], 'role' => 'input'],
        'directions' => ['input'],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/batch'],
      ],
      'Health' => [
        'kind' => 'object',
        'properties' => [
          [
            'name' => 'status',
            'type' => ['kind' => 'scalar', 'type' => 'string', 'refinements' => []],
            'optional' => false,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'api', 'pointer' => '/schemas/Health/properties/status'],
          ],
        ],
        'id' => 'Health',
        'name' => ['segments' => ['health'], 'role' => 'schema'],
        'directions' => ['output'],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'api', 'pointer' => '/schemas/Health'],
      ],
      'IssuesItem' => [
        'kind' => 'object',
        'properties' => [
          [
            'name' => 'pointer',
            'type' => ['kind' => 'scalar', 'type' => 'string', 'refinements' => []],
            'optional' => false,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'shared', 'pointer' => '/schemas/Issues/items/properties/pointer'],
          ],
          [
            'name' => 'rule',
            'type' => ['kind' => 'scalar', 'type' => 'string', 'refinements' => []],
            'optional' => false,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'shared', 'pointer' => '/schemas/Issues/items/properties/rule'],
          ],
        ],
        'id' => 'IssuesItem',
        'name' => ['segments' => ['issues'], 'role' => 'item'],
        'directions' => ['output'],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'shared', 'pointer' => '/schemas/Issues/items'],
      ],
      'PaymentEvent' => [
        'kind' => 'object',
        'properties' => [
          [
            'name' => 'id',
            'type' => ['kind' => 'scalar', 'type' => 'string', 'refinements' => []],
            'optional' => false,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'api', 'pointer' => '/schemas/PaymentEvent/properties/id'],
          ],
          [
            'name' => 'type',
            'type' => ['kind' => 'scalar', 'type' => 'string', 'refinements' => []],
            'optional' => false,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'api', 'pointer' => '/schemas/PaymentEvent/properties/type'],
          ],
          [
            'name' => 'data',
            'type' => [
              'kind' => 'opaque',
              'reason' => 'Stripe\'s object depends on the event type and its API version.',
              'origin' => ['layer' => 'api', 'pointer' => '/schemas/PaymentEvent/properties/data'],
            ],
            'optional' => false,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'api', 'pointer' => '/schemas/PaymentEvent/properties/data'],
          ],
        ],
        'id' => 'PaymentEvent',
        'name' => ['segments' => ['payment', 'event'], 'role' => 'schema'],
        'directions' => ['input'],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'api', 'pointer' => '/schemas/PaymentEvent'],
      ],
      'Preferences' => [
        'kind' => 'object',
        'properties' => [
          [
            'name' => 'locale',
            'type' => [
              'kind' => 'scalar',
              'type' => 'string',
              'refinements' => ['minLength' => 2, 'maxLength' => 35],
            ],
            'optional' => false,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'api', 'pointer' => '/schemas/Preferences/properties/locale'],
          ],
          [
            'name' => 'digest',
            'type' => ['kind' => 'scalar', 'type' => 'boolean', 'refinements' => []],
            'optional' => true,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'api', 'pointer' => '/schemas/Preferences/properties/digest'],
          ],
        ],
        'id' => 'Preferences',
        'name' => ['segments' => ['preferences'], 'role' => 'schema'],
        'directions' => ['output'],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'api', 'pointer' => '/schemas/Preferences'],
      ],
      'RecentAuthParams' => [
        'kind' => 'object',
        'properties' => [
          [
            'name' => 'intent',
            'type' => ['kind' => 'enum', 'enum' => 'ReauthIntent'],
            'optional' => false,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'shared', 'pointer' => '/rules/recentAuth/params/intent'],
          ],
        ],
        'id' => 'RecentAuthParams',
        'name' => ['segments' => ['recent', 'auth'], 'role' => 'params'],
        'directions' => ['input'],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'shared', 'pointer' => '/rules/recentAuth/params'],
      ],
      'RolesParams' => [
        'kind' => 'object',
        'properties' => [
          [
            'name' => 'allowed',
            'type' => ['kind' => 'array', 'items' => ['kind' => 'enum', 'enum' => 'Role'], 'minItems' => 1],
            'optional' => false,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'shared', 'pointer' => '/rights/roles/params/allowed'],
          ],
        ],
        'id' => 'RolesParams',
        'name' => ['segments' => ['roles'], 'role' => 'params'],
        'directions' => ['input'],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'shared', 'pointer' => '/rights/roles/params'],
      ],
      'ServicePrincipal' => [
        'kind' => 'object',
        'properties' => [
          [
            'name' => 'service',
            'type' => ['kind' => 'enum', 'enum' => 'Service'],
            'optional' => false,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'shared', 'pointer' => '/schemas/ServicePrincipal/properties/service'],
          ],
          [
            'name' => 'userId',
            'type' => ['kind' => 'scalar', 'type' => 'string', 'format' => 'uuid', 'refinements' => []],
            'optional' => false,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'shared', 'pointer' => '/schemas/ServicePrincipal/properties/userId'],
          ],
        ],
        'id' => 'ServicePrincipal',
        'name' => ['segments' => ['service', 'principal'], 'role' => 'schema'],
        'directions' => ['output'],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'shared', 'pointer' => '/schemas/ServicePrincipal'],
      ],
      'Task' => [
        'kind' => 'object',
        'properties' => [
          [
            'name' => 'taskId',
            'type' => ['kind' => 'scalar', 'type' => 'string', 'format' => 'uuid', 'refinements' => []],
            'optional' => false,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'shared', 'pointer' => '/schemas/Task/properties/taskId'],
          ],
          [
            'name' => 'title',
            'type' => [
              'kind' => 'scalar',
              'type' => 'string',
              'refinements' => ['minLength' => 1, 'maxLength' => 200],
            ],
            'optional' => false,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'shared', 'pointer' => '/schemas/Task/properties/title'],
          ],
          [
            'name' => 'state',
            'type' => ['kind' => 'enum', 'enum' => 'TaskState'],
            'optional' => false,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'shared', 'pointer' => '/schemas/Task/properties/state'],
          ],
          [
            'name' => 'effort',
            'type' => ['kind' => 'scalar', 'type' => 'integer', 'refinements' => ['minimum' => '0']],
            'optional' => true,
            'nullable' => false,
            'sensitive' => false,
            'restrictedTo' => [
              'right' => 'tasks.seeEffort',
              'origin' => ['layer' => 'shared', 'pointer' => '/schemas/Task/properties/effort/restrictedTo'],
            ],
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'shared', 'pointer' => '/schemas/Task/properties/effort'],
          ],
          [
            'name' => 'version',
            'type' => ['kind' => 'scalar', 'type' => 'integer', 'refinements' => ['minimum' => '1']],
            'optional' => false,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'shared', 'pointer' => '/schemas/Task/properties/version'],
          ],
          [
            'name' => 'createdAt',
            'type' => ['kind' => 'scalar', 'type' => 'string', 'format' => 'date-time', 'refinements' => []],
            'optional' => false,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'shared', 'pointer' => '/schemas/Task/properties/createdAt'],
          ],
        ],
        'id' => 'Task',
        'name' => ['segments' => ['task'], 'role' => 'schema'],
        'directions' => ['output'],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'shared', 'pointer' => '/schemas/Task'],
      ],
      'TaskQuery' => [
        'kind' => 'object',
        'properties' => [
          [
            'name' => 'text',
            'type' => ['kind' => 'scalar', 'type' => 'string', 'refinements' => ['maxLength' => 200]],
            'optional' => true,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'api', 'pointer' => '/schemas/TaskQuery/properties/text'],
          ],
          [
            'name' => 'states',
            'type' => [
              'kind' => 'array',
              'items' => ['kind' => 'enum', 'enum' => 'TaskState'],
              'maxItems' => 3,
            ],
            'optional' => true,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'api', 'pointer' => '/schemas/TaskQuery/properties/states'],
          ],
        ],
        'id' => 'TaskQuery',
        'name' => ['segments' => ['task', 'query'], 'role' => 'schema'],
        'directions' => ['input'],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'api', 'pointer' => '/schemas/TaskQuery'],
      ],
      'TaskSearchResult' => [
        'kind' => 'object',
        'properties' => [
          [
            'name' => 'items',
            'type' => ['kind' => 'array', 'items' => ['kind' => 'ref', 'schema' => 'Task']],
            'optional' => false,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'api', 'pointer' => '/schemas/TaskSearchResult/properties/items'],
          ],
          [
            'name' => 'total',
            'type' => ['kind' => 'scalar', 'type' => 'integer', 'refinements' => ['minimum' => '0']],
            'optional' => true,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'api', 'pointer' => '/schemas/TaskSearchResult/properties/total'],
          ],
        ],
        'id' => 'TaskSearchResult',
        'name' => ['segments' => ['task', 'search', 'result'], 'role' => 'schema'],
        'directions' => ['output'],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'api', 'pointer' => '/schemas/TaskSearchResult'],
      ],
      'UpdatePreferences' => [
        'kind' => 'object',
        'properties' => [
          [
            'name' => 'locale',
            'type' => [
              'kind' => 'scalar',
              'type' => 'string',
              'refinements' => ['minLength' => 2, 'maxLength' => 35],
            ],
            'optional' => true,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'api', 'pointer' => '/schemas/Preferences/properties/locale'],
          ],
          [
            'name' => 'digest',
            'type' => ['kind' => 'scalar', 'type' => 'boolean', 'refinements' => []],
            'optional' => true,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'api', 'pointer' => '/schemas/Preferences/properties/digest'],
          ],
        ],
        'id' => 'UpdatePreferences',
        'name' => ['segments' => ['update', 'preferences'], 'role' => 'schema'],
        'directions' => ['input'],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'api', 'pointer' => '/schemas/UpdatePreferences'],
      ],
      'UpdateTask' => [
        'kind' => 'object',
        'properties' => [
          [
            'name' => 'title',
            'type' => [
              'kind' => 'scalar',
              'type' => 'string',
              'refinements' => ['minLength' => 1, 'maxLength' => 200],
            ],
            'optional' => true,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'shared', 'pointer' => '/schemas/Task/properties/title'],
          ],
          [
            'name' => 'state',
            'type' => ['kind' => 'enum', 'enum' => 'TaskState'],
            'optional' => true,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'shared', 'pointer' => '/schemas/Task/properties/state'],
          ],
          [
            'name' => 'effort',
            'type' => ['kind' => 'scalar', 'type' => 'integer', 'refinements' => ['minimum' => '0']],
            'optional' => true,
            'nullable' => false,
            'sensitive' => false,
            'restrictedTo' => [
              'right' => 'tasks.seeEffort',
              'origin' => ['layer' => 'shared', 'pointer' => '/schemas/Task/properties/effort/restrictedTo'],
            ],
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'shared', 'pointer' => '/schemas/Task/properties/effort'],
          ],
          [
            'name' => 'expectedVersion',
            'type' => ['kind' => 'scalar', 'type' => 'integer', 'refinements' => ['minimum' => '1']],
            'optional' => false,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => [
              'layer' => 'api',
              'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/concurrency/version',
            ],
            'derivedFrom' => [
              'derivation' => 'concurrency.version',
              'from' => [
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/concurrency/version',
                ],
              ],
            ],
          ],
        ],
        'id' => 'UpdateTask',
        'name' => ['segments' => ['update', 'task'], 'role' => 'schema'],
        'directions' => ['input'],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'api', 'pointer' => '/schemas/UpdateTask'],
      ],
      'UserPrincipal' => [
        'kind' => 'object',
        'properties' => [
          [
            'name' => 'userId',
            'type' => ['kind' => 'scalar', 'type' => 'string', 'format' => 'uuid', 'refinements' => []],
            'optional' => false,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'shared', 'pointer' => '/schemas/UserPrincipal/properties/userId'],
          ],
        ],
        'id' => 'UserPrincipal',
        'name' => ['segments' => ['user', 'principal'], 'role' => 'schema'],
        'directions' => ['output'],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'shared', 'pointer' => '/schemas/UserPrincipal'],
      ],
      'WebhookCaller' => [
        'kind' => 'object',
        'properties' => [
          [
            'name' => 'account',
            'type' => ['kind' => 'scalar', 'type' => 'string', 'refinements' => []],
            'optional' => false,
            'nullable' => false,
            'sensitive' => false,
            'deprecated' => false,
            'docs' => [],
            'extensions' => [],
            'origin' => ['layer' => 'shared', 'pointer' => '/schemas/WebhookCaller/properties/account'],
          ],
        ],
        'id' => 'WebhookCaller',
        'name' => ['segments' => ['webhook', 'caller'], 'role' => 'schema'],
        'directions' => ['output'],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'shared', 'pointer' => '/schemas/WebhookCaller'],
      ],
    ],
    'enums' => [
      'ReauthIntent' => [
        'id' => 'ReauthIntent',
        'name' => ['segments' => ['reauth', 'intent'], 'role' => 'schema'],
        'values' => ['purge_task'],
        'localReason' => 'The actions that ask for a fresh sign-in.',
        'directions' => ['input'],
        'docs' => [],
        'origin' => ['layer' => 'shared', 'pointer' => '/enums/ReauthIntent'],
      ],
      'Role' => [
        'id' => 'Role',
        'name' => ['segments' => ['role'], 'role' => 'schema'],
        'values' => ['owner', 'editor', 'viewer'],
        'localReason' => 'Roles are local to this product.',
        'directions' => ['input'],
        'docs' => [],
        'origin' => ['layer' => 'shared', 'pointer' => '/enums/Role'],
      ],
      'Service' => [
        'id' => 'Service',
        'name' => ['segments' => ['service'], 'role' => 'schema'],
        'values' => ['catalog', 'ticketing'],
        'localReason' => 'The product\'s internal services.',
        'directions' => ['input', 'output'],
        'docs' => [],
        'origin' => ['layer' => 'shared', 'pointer' => '/enums/Service'],
      ],
      'Surface' => [
        'id' => 'Surface',
        'name' => ['segments' => ['surface'], 'role' => 'schema'],
        'values' => ['app', 'studio'],
        'localReason' => 'The product\'s entry points.',
        'directions' => ['input'],
        'docs' => [],
        'origin' => ['layer' => 'shared', 'pointer' => '/enums/Surface'],
      ],
      'TaskState' => [
        'id' => 'TaskState',
        'name' => ['segments' => ['task', 'state'], 'role' => 'schema'],
        'values' => ['open', 'done', 'archived'],
        'localReason' => 'Task states belong to this api.',
        'directions' => ['input', 'output'],
        'docs' => [],
        'origin' => ['layer' => 'shared', 'pointer' => '/enums/TaskState'],
      ],
    ],
    'operations' => [
      [
        'kind' => 'httpOperation',
        'id' => 'createTask',
        'name' => ['segments' => ['create', 'task'], 'role' => 'operation'],
        'surface' => 'app',
        'op' => 'create',
        'resource' => ['type' => 'tasks', 'idProperty' => 'taskId'],
        'features' => [],
        'method' => 'post',
        'path' => '/v1/channels/{channelId}/tasks',
        'safe' => false,
        'params' => [
          'path' => [
            [
              'name' => 'channelId',
              'type' => ['kind' => 'scalar', 'type' => 'string', 'format' => 'uuid', 'refinements' => []],
              'required' => true,
              'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/channels/id/channelId'],
            ],
          ],
          'query' => [],
          'header' => [
            [
              'name' => 'Authorization',
              'type' => ['kind' => 'scalar', 'type' => 'string', 'refinements' => []],
              'required' => false,
              'derivedFrom' => [
                'derivation' => 'identity.authenticate',
                'from' => [
                  ['layer' => 'api', 'pointer' => '/surfaces/app/identity'],
                  ['layer' => 'shared', 'pointer' => '/schemes/bearer'],
                ],
              ],
            ],
            [
              'name' => 'X-Csrf-Token',
              'type' => ['kind' => 'scalar', 'type' => 'string', 'refinements' => []],
              'required' => false,
              'derivedFrom' => [
                'derivation' => 'csrf.cookieWrite',
                'from' => [
                  ['layer' => 'shared', 'pointer' => '/identities/user'],
                  ['layer' => 'shared', 'pointer' => '/schemes/sessionCookie'],
                ],
              ],
            ],
            [
              'name' => 'Idempotency-Key',
              'type' => ['kind' => 'scalar', 'type' => 'string', 'refinements' => []],
              'required' => true,
              'derivedFrom' => [
                'derivation' => 'idempotency.write',
                'from' => [['layer' => 'shared', 'pointer' => '/conventions/idempotency']],
              ],
            ],
          ],
        ],
        'unknownQuery' => ['policy' => 'refuse'],
        'access' => [
          'kind' => 'identity',
          'identity' => 'user',
          'schemes' => ['bearer', 'sessionCookie'],
          'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/identity'],
        ],
        'callerKinds' => ['identified'],
        'principalRequires' => [],
        'scopes' => [
          [
            'scope' => 'channel',
            'source' => ['in' => 'path', 'name' => 'channelId'],
            'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/channels/member/scopes/channel'],
          ],
        ],
        'requires' => [
          [
            'kind' => 'rule',
            'rule' => 'throttle',
            'bucket' => 'write',
            'entry' => 'writeThrottle',
            'origin' => [
              'layer' => 'api',
              'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/create/requires/0',
            ],
          ],
          [
            'kind' => 'right',
            'right' => 'roles',
            'params' => ['allowed' => ['owner', 'editor']],
            'subject' => ['source' => ['in' => 'scope', 'name' => 'channel'], 'defaulted' => true],
            'entry' => 'channelEditor',
            'origin' => [
              'layer' => 'api',
              'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/create/requires/1',
            ],
          ],
        ],
        'bindings' => [],
        'input' => [
          'media' => 'application/json',
          'schema' => ['kind' => 'ref', 'schema' => 'CreateTask'],
          'bodyLimitBytes' => 1048576,
          'rawBody' => false,
          'origin' => [
            'layer' => 'api',
            'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/create/input',
          ],
        ],
        'responses' => [
          [
            'status' => 201,
            'media' => 'application/json',
            'body' => ['kind' => 'ref', 'schema' => 'Task'],
            'shape' => 'item',
            'headers' => [
              [
                'name' => 'Idempotency-Replayed',
                'type' => ['kind' => 'scalar', 'type' => 'boolean', 'refinements' => []],
                'required' => false,
                'derivedFrom' => [
                  'derivation' => 'idempotency.write',
                  'from' => [['layer' => 'shared', 'pointer' => '/conventions/idempotency']],
                ],
              ],
            ],
            'origin' => [
              'layer' => 'api',
              'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/item',
            ],
            'derivedFrom' => [
              'derivation' => 'response.format',
              'from' => [['layer' => 'core', 'pointer' => '/formats/bare']],
            ],
          ],
        ],
        'errors' => [
          [
            'code' => 'api.schema_invalid',
            'roles' => [
              [
                'role' => 'schemaInvalid',
                'params' => [
                  'kind' => 'object',
                  'members' => [
                    [
                      'name' => ['kind' => 'text', 'text' => 'issues'],
                      'value' => [
                        'kind' => 'each',
                        'of' => 'issues',
                        'as' => [
                          'kind' => 'object',
                          'members' => [
                            [
                              'name' => ['kind' => 'text', 'text' => 'pointer'],
                              'value' => [
                                'kind' => 'slot',
                                'slot' => 'item',
                                'path' => ['pointer'],
                              ],
                            ],
                            [
                              'name' => ['kind' => 'text', 'text' => 'rule'],
                              'value' => [
                                'kind' => 'slot',
                                'slot' => 'item',
                                'path' => ['rule'],
                              ],
                            ],
                          ],
                        ],
                      ],
                    ],
                  ],
                ],
              ],
            ],
            'derivedFrom' => [
              'derivation' => 'input.invalid',
              'from' => [
                ['layer' => 'shared', 'pointer' => '/conventions/idempotency'],
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/create',
                ],
                ['layer' => 'shared', 'pointer' => '/conventions/errors/derived/schemaInvalid'],
              ],
            ],
          ],
          [
            'code' => 'api.unauthenticated',
            'roles' => [['role' => 'unauthenticated']],
            'derivedFrom' => [
              'derivation' => 'identity.authenticate',
              'from' => [['layer' => 'api', 'pointer' => '/surfaces/app/identity']],
            ],
          ],
          [
            'code' => 'api.csrf_invalid',
            'roles' => [['role' => 'csrfInvalid']],
            'derivedFrom' => [
              'derivation' => 'csrf.cookieWrite',
              'from' => [
                ['layer' => 'shared', 'pointer' => '/identities/user'],
                ['layer' => 'shared', 'pointer' => '/schemes/sessionCookie'],
              ],
            ],
          ],
          [
            'code' => 'api.forbidden',
            'roles' => [
              [
                'role' => 'forbidden',
                'params' => [
                  'kind' => 'object',
                  'members' => [
                    [
                      'name' => ['kind' => 'text', 'text' => 'pointer'],
                      'value' => ['kind' => 'slot', 'slot' => 'pointer', 'path' => []],
                    ],
                  ],
                ],
              ],
            ],
            'derivedFrom' => [
              'derivation' => 'requirement.errors',
              'from' => [
                ['layer' => 'api', 'pointer' => '/schemas/CreateTask/properties/effort/restrictedTo'],
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/create/requires/1',
                ],
              ],
            ],
          ],
          [
            'code' => 'api.not_found',
            'derivedFrom' => [
              'derivation' => 'scope.errors',
              'from' => [
                ['layer' => 'api', 'pointer' => '/surfaces/app/routes/channels/member/scopes/channel'],
              ],
            ],
          ],
          [
            'code' => 'api.idempotency_in_progress',
            'roles' => [['role' => 'idempotencyInProgress']],
            'derivedFrom' => [
              'derivation' => 'idempotency.write',
              'from' => [['layer' => 'shared', 'pointer' => '/conventions/idempotency']],
            ],
          ],
          [
            'code' => 'api.payload_too_large',
            'roles' => [
              [
                'role' => 'payloadTooLarge',
                'params' => [
                  'kind' => 'object',
                  'members' => [
                    [
                      'name' => ['kind' => 'text', 'text' => 'limitBytes'],
                      'value' => ['kind' => 'slot', 'slot' => 'limitBytes', 'path' => []],
                    ],
                  ],
                ],
              ],
            ],
            'derivedFrom' => [
              'derivation' => 'body.limit',
              'from' => [
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/create/input',
                ],
              ],
            ],
          ],
          [
            'code' => 'api.unsupported_media_type',
            'roles' => [['role' => 'unsupportedMediaType']],
            'derivedFrom' => [
              'derivation' => 'body.media',
              'from' => [
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/create/input',
                ],
              ],
            ],
          ],
          [
            'code' => 'api.idempotency_key_reused',
            'roles' => [['role' => 'idempotencyKeyReused']],
            'derivedFrom' => [
              'derivation' => 'idempotency.write',
              'from' => [['layer' => 'shared', 'pointer' => '/conventions/idempotency']],
            ],
          ],
          [
            'code' => 'api.rate_limited',
            'retryHeader' => [
              'name' => 'Retry-After',
              'param' => 'retryAfterMs',
              'unit' => 's',
              'derivedFrom' => [
                'derivation' => 'rule.bucket',
                'from' => [
                  [
                    'layer' => 'api',
                    'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/create/requires/0',
                  ],
                ],
              ],
            ],
            'derivedFrom' => [
              'derivation' => 'requirement.errors',
              'from' => [
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/create/requires/0',
                ],
              ],
            ],
          ],
          [
            'code' => 'api.internal',
            'roles' => [['role' => 'undeclaredStatus']],
            'derivedFrom' => [
              'derivation' => 'response.undeclared',
              'from' => [
                ['layer' => 'shared', 'pointer' => '/conventions/errors/every/0'],
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/create',
                ],
              ],
            ],
          ],
        ],
        'fieldRights' => [
          [
            'schema' => 'CreateTask',
            'pointer' => '/effort',
            'right' => 'roles',
            'params' => ['allowed' => ['owner']],
            'subject' => ['source' => ['in' => 'scope', 'name' => 'channel']],
            'direction' => 'input',
            'inputPolicy' => 'reject',
            'derivedFrom' => [
              'derivation' => 'fieldRight.restricted',
              'from' => [
                ['layer' => 'api', 'pointer' => '/schemas/CreateTask/properties/effort/restrictedTo'],
              ],
            ],
          ],
          [
            'schema' => 'Task',
            'pointer' => '/effort',
            'right' => 'tasks.seeEffort',
            'subject' => ['source' => ['in' => 'holderField', 'name' => 'taskId']],
            'direction' => 'output',
            'derivedFrom' => [
              'derivation' => 'fieldRight.restricted',
              'from' => [['layer' => 'shared', 'pointer' => '/schemas/Task/properties/effort/restrictedTo']],
            ],
          ],
        ],
        'idempotency' => [
          'kind' => 'derived',
          'header' => 'Idempotency-Key',
          'replayHeader' => 'Idempotency-Replayed',
          'lifetimeMs' => 86400000,
          'required' => true,
          'enforce' => 'boundary',
          'derivedFrom' => [
            'derivation' => 'idempotency.write',
            'from' => [['layer' => 'shared', 'pointer' => '/conventions/idempotency']],
          ],
        ],
        'upstream' => [],
        'maturity' => [
          'level' => 'provisional',
          'source' => 'api',
          'origin' => ['layer' => 'api', 'pointer' => '/api/maturity'],
        ],
        'internal' => false,
        'csrf' => [
          'kind' => 'derived',
          'header' => 'X-Csrf-Token',
          'derivedFrom' => [
            'derivation' => 'csrf.cookieWrite',
            'from' => [
              ['layer' => 'shared', 'pointer' => '/identities/user'],
              ['layer' => 'shared', 'pointer' => '/schemes/sessionCookie'],
            ],
          ],
        ],
        'format' => 'bare',
        'tags' => [],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/create'],
      ],
      [
        'kind' => 'httpOperation',
        'id' => 'getChannel',
        'name' => ['segments' => ['get', 'channel'], 'role' => 'operation'],
        'surface' => 'app',
        'op' => 'get',
        'resource' => ['type' => 'channels', 'idParam' => 'channelId', 'idProperty' => 'channelId'],
        'features' => [],
        'method' => 'get',
        'path' => '/v1/channels/{channelId}',
        'safe' => true,
        'params' => [
          'path' => [
            [
              'name' => 'channelId',
              'type' => ['kind' => 'scalar', 'type' => 'string', 'format' => 'uuid', 'refinements' => []],
              'required' => true,
              'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/channels/id/channelId'],
            ],
          ],
          'query' => [],
          'header' => [
            [
              'name' => 'Authorization',
              'type' => ['kind' => 'scalar', 'type' => 'string', 'refinements' => []],
              'required' => false,
              'derivedFrom' => [
                'derivation' => 'identity.authenticate',
                'from' => [
                  ['layer' => 'api', 'pointer' => '/surfaces/app/identity'],
                  ['layer' => 'shared', 'pointer' => '/schemes/bearer'],
                ],
              ],
            ],
          ],
        ],
        'unknownQuery' => ['policy' => 'refuse'],
        'access' => [
          'kind' => 'identity',
          'identity' => 'user',
          'schemes' => ['bearer', 'sessionCookie'],
          'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/identity'],
        ],
        'callerKinds' => ['identified'],
        'principalRequires' => [],
        'scopes' => [
          [
            'scope' => 'channel',
            'source' => ['in' => 'path', 'name' => 'channelId'],
            'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/channels/member/scopes/channel'],
          ],
        ],
        'requires' => [],
        'bindings' => [],
        'responses' => [
          [
            'status' => 200,
            'media' => 'application/json',
            'body' => ['kind' => 'ref', 'schema' => 'Channel'],
            'shape' => 'item',
            'headers' => [],
            'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/channels/item'],
            'derivedFrom' => [
              'derivation' => 'response.format',
              'from' => [['layer' => 'core', 'pointer' => '/formats/bare']],
            ],
          ],
        ],
        'errors' => [
          [
            'code' => 'api.schema_invalid',
            'roles' => [
              [
                'role' => 'schemaInvalid',
                'params' => [
                  'kind' => 'object',
                  'members' => [
                    [
                      'name' => ['kind' => 'text', 'text' => 'issues'],
                      'value' => [
                        'kind' => 'each',
                        'of' => 'issues',
                        'as' => [
                          'kind' => 'object',
                          'members' => [
                            [
                              'name' => ['kind' => 'text', 'text' => 'pointer'],
                              'value' => [
                                'kind' => 'slot',
                                'slot' => 'item',
                                'path' => ['pointer'],
                              ],
                            ],
                            [
                              'name' => ['kind' => 'text', 'text' => 'rule'],
                              'value' => [
                                'kind' => 'slot',
                                'slot' => 'item',
                                'path' => ['rule'],
                              ],
                            ],
                          ],
                        ],
                      ],
                    ],
                  ],
                ],
              ],
            ],
            'derivedFrom' => [
              'derivation' => 'input.invalid',
              'from' => [
                ['layer' => 'api', 'pointer' => '/surfaces/app/routes/channels/ops/1'],
                ['layer' => 'shared', 'pointer' => '/conventions/errors/derived/schemaInvalid'],
              ],
            ],
          ],
          [
            'code' => 'api.unauthenticated',
            'roles' => [['role' => 'unauthenticated']],
            'derivedFrom' => [
              'derivation' => 'identity.authenticate',
              'from' => [['layer' => 'api', 'pointer' => '/surfaces/app/identity']],
            ],
          ],
          [
            'code' => 'api.not_found',
            'derivedFrom' => [
              'derivation' => 'scope.errors',
              'from' => [
                ['layer' => 'api', 'pointer' => '/surfaces/app/routes/channels/member/scopes/channel'],
              ],
            ],
          ],
          [
            'code' => 'api.internal',
            'roles' => [['role' => 'undeclaredStatus']],
            'derivedFrom' => [
              'derivation' => 'response.undeclared',
              'from' => [
                ['layer' => 'shared', 'pointer' => '/conventions/errors/every/0'],
                ['layer' => 'api', 'pointer' => '/surfaces/app/routes/channels/ops/1'],
              ],
            ],
          ],
        ],
        'fieldRights' => [],
        'upstream' => [],
        'maturity' => [
          'level' => 'provisional',
          'source' => 'api',
          'origin' => ['layer' => 'api', 'pointer' => '/api/maturity'],
        ],
        'internal' => false,
        'format' => 'bare',
        'tags' => [],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/channels/ops/1'],
      ],
      [
        'kind' => 'httpOperation',
        'id' => 'getDraft',
        'name' => ['segments' => ['get', 'draft'], 'role' => 'operation'],
        'surface' => 'app',
        'op' => 'get',
        'resource' => ['type' => 'drafts', 'idParam' => 'draftId', 'idProperty' => 'draftId'],
        'features' => [],
        'method' => 'get',
        'path' => '/v1/me/drafts/{draftId}',
        'safe' => true,
        'params' => [
          'path' => [
            [
              'name' => 'draftId',
              'type' => ['kind' => 'scalar', 'type' => 'string', 'format' => 'uuid', 'refinements' => []],
              'required' => true,
              'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/me/routes/drafts/id/draftId'],
            ],
          ],
          'query' => [],
          'header' => [
            [
              'name' => 'Authorization',
              'type' => ['kind' => 'scalar', 'type' => 'string', 'refinements' => []],
              'required' => false,
              'derivedFrom' => [
                'derivation' => 'identity.authenticate',
                'from' => [
                  ['layer' => 'api', 'pointer' => '/surfaces/app/identity'],
                  ['layer' => 'shared', 'pointer' => '/schemes/bearer'],
                ],
              ],
            ],
          ],
        ],
        'unknownQuery' => ['policy' => 'refuse'],
        'access' => [
          'kind' => 'identity',
          'identity' => 'user',
          'schemes' => ['bearer', 'sessionCookie'],
          'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/identity'],
        ],
        'callerKinds' => ['identified'],
        'principalRequires' => [],
        'scopes' => [],
        'requires' => [],
        'bindings' => [],
        'responses' => [
          [
            'status' => 200,
            'media' => 'application/json',
            'body' => ['kind' => 'ref', 'schema' => 'Draft'],
            'shape' => 'item',
            'headers' => [],
            'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/me/routes/drafts/item'],
            'derivedFrom' => [
              'derivation' => 'response.format',
              'from' => [['layer' => 'core', 'pointer' => '/formats/bare']],
            ],
          ],
        ],
        'errors' => [
          [
            'code' => 'api.schema_invalid',
            'roles' => [
              [
                'role' => 'schemaInvalid',
                'params' => [
                  'kind' => 'object',
                  'members' => [
                    [
                      'name' => ['kind' => 'text', 'text' => 'issues'],
                      'value' => [
                        'kind' => 'each',
                        'of' => 'issues',
                        'as' => [
                          'kind' => 'object',
                          'members' => [
                            [
                              'name' => ['kind' => 'text', 'text' => 'pointer'],
                              'value' => [
                                'kind' => 'slot',
                                'slot' => 'item',
                                'path' => ['pointer'],
                              ],
                            ],
                            [
                              'name' => ['kind' => 'text', 'text' => 'rule'],
                              'value' => [
                                'kind' => 'slot',
                                'slot' => 'item',
                                'path' => ['rule'],
                              ],
                            ],
                          ],
                        ],
                      ],
                    ],
                  ],
                ],
              ],
            ],
            'derivedFrom' => [
              'derivation' => 'input.invalid',
              'from' => [
                ['layer' => 'api', 'pointer' => '/surfaces/app/routes/me/routes/drafts/ops/get'],
                ['layer' => 'shared', 'pointer' => '/conventions/errors/derived/schemaInvalid'],
              ],
            ],
          ],
          [
            'code' => 'api.unauthenticated',
            'roles' => [['role' => 'unauthenticated']],
            'derivedFrom' => [
              'derivation' => 'identity.authenticate',
              'from' => [['layer' => 'api', 'pointer' => '/surfaces/app/identity']],
            ],
          ],
          [
            'code' => 'api.not_found',
            'roles' => [['role' => 'notFound']],
            'derivedFrom' => [
              'derivation' => 'member.notFound',
              'from' => [
                ['layer' => 'api', 'pointer' => '/surfaces/app/routes/me/routes/drafts/ops/get'],
                ['layer' => 'api', 'pointer' => '/surfaces/app/routes/me/routes/drafts/owner'],
              ],
            ],
          ],
          [
            'code' => 'api.internal',
            'roles' => [['role' => 'undeclaredStatus']],
            'derivedFrom' => [
              'derivation' => 'response.undeclared',
              'from' => [
                ['layer' => 'shared', 'pointer' => '/conventions/errors/every/0'],
                ['layer' => 'api', 'pointer' => '/surfaces/app/routes/me/routes/drafts/ops/get'],
              ],
            ],
          ],
        ],
        'fieldRights' => [],
        'owner' => [
          'kind' => 'caller',
          'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/me/routes/drafts/owner'],
        ],
        'upstream' => [],
        'maturity' => [
          'level' => 'provisional',
          'source' => 'api',
          'origin' => ['layer' => 'api', 'pointer' => '/api/maturity'],
        ],
        'internal' => false,
        'format' => 'bare',
        'tags' => [],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/me/routes/drafts/ops/get'],
      ],
      [
        'kind' => 'httpOperation',
        'id' => 'getPreferences',
        'name' => ['segments' => ['get', 'preferences'], 'role' => 'operation'],
        'surface' => 'app',
        'op' => 'get',
        'resource' => ['type' => 'preferences'],
        'features' => [],
        'method' => 'get',
        'path' => '/v1/me/preferences',
        'safe' => true,
        'params' => [
          'path' => [],
          'query' => [],
          'header' => [
            [
              'name' => 'Authorization',
              'type' => ['kind' => 'scalar', 'type' => 'string', 'refinements' => []],
              'required' => false,
              'derivedFrom' => [
                'derivation' => 'identity.authenticate',
                'from' => [
                  ['layer' => 'api', 'pointer' => '/surfaces/app/identity'],
                  ['layer' => 'shared', 'pointer' => '/schemes/bearer'],
                ],
              ],
            ],
            [
              'name' => 'If-None-Match',
              'type' => ['kind' => 'scalar', 'type' => 'string', 'refinements' => []],
              'required' => false,
              'derivedFrom' => [
                'derivation' => 'cache.etag',
                'from' => [
                  [
                    'layer' => 'api',
                    'pointer' => '/surfaces/app/routes/me/routes/preferences/ops/get/cache',
                  ],
                ],
              ],
            ],
          ],
        ],
        'unknownQuery' => ['policy' => 'refuse'],
        'access' => [
          'kind' => 'identity',
          'identity' => 'user',
          'schemes' => ['bearer', 'sessionCookie'],
          'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/identity'],
        ],
        'callerKinds' => ['identified'],
        'principalRequires' => [],
        'scopes' => [],
        'requires' => [],
        'bindings' => [],
        'responses' => [
          [
            'status' => 200,
            'media' => 'application/json',
            'body' => ['kind' => 'ref', 'schema' => 'Preferences'],
            'shape' => 'item',
            'headers' => [
              [
                'name' => 'ETag',
                'type' => ['kind' => 'scalar', 'type' => 'string', 'refinements' => []],
                'required' => true,
                'derivedFrom' => [
                  'derivation' => 'cache.etag',
                  'from' => [
                    [
                      'layer' => 'api',
                      'pointer' => '/surfaces/app/routes/me/routes/preferences/ops/get/cache',
                    ],
                  ],
                ],
              ],
            ],
            'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/me/routes/preferences/item'],
            'derivedFrom' => [
              'derivation' => 'response.format',
              'from' => [['layer' => 'core', 'pointer' => '/formats/bare']],
            ],
          ],
          [
            'status' => 304,
            'shape' => 'empty',
            'headers' => [
              [
                'name' => 'ETag',
                'type' => ['kind' => 'scalar', 'type' => 'string', 'refinements' => []],
                'required' => true,
                'derivedFrom' => [
                  'derivation' => 'cache.etag',
                  'from' => [
                    [
                      'layer' => 'api',
                      'pointer' => '/surfaces/app/routes/me/routes/preferences/ops/get/cache',
                    ],
                  ],
                ],
              ],
            ],
            'derivedFrom' => [
              'derivation' => 'cache.etag',
              'from' => [
                ['layer' => 'api', 'pointer' => '/surfaces/app/routes/me/routes/preferences/ops/get/cache'],
              ],
            ],
          ],
        ],
        'errors' => [
          [
            'code' => 'api.schema_invalid',
            'roles' => [
              [
                'role' => 'schemaInvalid',
                'params' => [
                  'kind' => 'object',
                  'members' => [
                    [
                      'name' => ['kind' => 'text', 'text' => 'issues'],
                      'value' => [
                        'kind' => 'each',
                        'of' => 'issues',
                        'as' => [
                          'kind' => 'object',
                          'members' => [
                            [
                              'name' => ['kind' => 'text', 'text' => 'pointer'],
                              'value' => [
                                'kind' => 'slot',
                                'slot' => 'item',
                                'path' => ['pointer'],
                              ],
                            ],
                            [
                              'name' => ['kind' => 'text', 'text' => 'rule'],
                              'value' => [
                                'kind' => 'slot',
                                'slot' => 'item',
                                'path' => ['rule'],
                              ],
                            ],
                          ],
                        ],
                      ],
                    ],
                  ],
                ],
              ],
            ],
            'derivedFrom' => [
              'derivation' => 'input.invalid',
              'from' => [
                ['layer' => 'api', 'pointer' => '/surfaces/app/routes/me/routes/preferences/ops/get'],
                ['layer' => 'shared', 'pointer' => '/conventions/errors/derived/schemaInvalid'],
              ],
            ],
          ],
          [
            'code' => 'api.unauthenticated',
            'roles' => [['role' => 'unauthenticated']],
            'derivedFrom' => [
              'derivation' => 'identity.authenticate',
              'from' => [['layer' => 'api', 'pointer' => '/surfaces/app/identity']],
            ],
          ],
          [
            'code' => 'api.not_found',
            'roles' => [['role' => 'notFound']],
            'derivedFrom' => [
              'derivation' => 'owner.caller',
              'from' => [['layer' => 'api', 'pointer' => '/surfaces/app/routes/me/routes/preferences/owner']],
            ],
          ],
          [
            'code' => 'api.internal',
            'roles' => [['role' => 'undeclaredStatus']],
            'derivedFrom' => [
              'derivation' => 'response.undeclared',
              'from' => [
                ['layer' => 'shared', 'pointer' => '/conventions/errors/every/0'],
                ['layer' => 'api', 'pointer' => '/surfaces/app/routes/me/routes/preferences/ops/get'],
              ],
            ],
          ],
        ],
        'fieldRights' => [],
        'owner' => [
          'kind' => 'caller',
          'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/me/routes/preferences/owner'],
        ],
        'cache' => [
          'family' => 'minute',
          'directives' => [
            'maxAgeMs' => 60000,
            'immutable' => false,
            'noCache' => false,
            'mustRevalidate' => false,
          ],
          'anonymous' => 'private',
          'vary' => ['Authorization', 'Cookie'],
          'etag' => true,
          'perCallerKind' => [['caller' => 'identified', 'cacheControl' => 'private, max-age=60']],
          'noStore' => false,
          'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/me/routes/preferences/ops/get/cache'],
          'derivedFrom' => [
            'derivation' => 'cache.headers',
            'from' => [
              ['layer' => 'api', 'pointer' => '/surfaces/app/routes/me/routes/preferences/ops/get/cache'],
              ['layer' => 'shared', 'pointer' => '/conventions/cache/families/minute'],
            ],
          ],
        ],
        'upstream' => [],
        'maturity' => [
          'level' => 'provisional',
          'source' => 'api',
          'origin' => ['layer' => 'api', 'pointer' => '/api/maturity'],
        ],
        'internal' => false,
        'format' => 'bare',
        'tags' => [],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/me/routes/preferences/ops/get'],
      ],
      [
        'kind' => 'httpOperation',
        'id' => 'getTask',
        'name' => ['segments' => ['get', 'task'], 'role' => 'operation'],
        'surface' => 'app',
        'op' => 'get',
        'resource' => ['type' => 'tasks', 'idParam' => 'taskId', 'idProperty' => 'taskId'],
        'features' => [],
        'method' => 'get',
        'path' => '/v1/channels/{channelId}/tasks/{taskId}',
        'safe' => true,
        'params' => [
          'path' => [
            [
              'name' => 'channelId',
              'type' => ['kind' => 'scalar', 'type' => 'string', 'format' => 'uuid', 'refinements' => []],
              'required' => true,
              'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/channels/id/channelId'],
            ],
            [
              'name' => 'taskId',
              'type' => ['kind' => 'scalar', 'type' => 'string', 'format' => 'uuid', 'refinements' => []],
              'required' => true,
              'origin' => [
                'layer' => 'api',
                'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/id/taskId',
              ],
            ],
          ],
          'query' => [],
          'header' => [
            [
              'name' => 'Authorization',
              'type' => ['kind' => 'scalar', 'type' => 'string', 'refinements' => []],
              'required' => false,
              'derivedFrom' => [
                'derivation' => 'identity.authenticate',
                'from' => [
                  ['layer' => 'api', 'pointer' => '/surfaces/app/identity'],
                  ['layer' => 'shared', 'pointer' => '/schemes/bearer'],
                ],
              ],
            ],
          ],
        ],
        'unknownQuery' => ['policy' => 'refuse'],
        'access' => [
          'kind' => 'identity',
          'identity' => 'user',
          'schemes' => ['bearer', 'sessionCookie'],
          'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/identity'],
        ],
        'callerKinds' => ['identified'],
        'principalRequires' => [],
        'scopes' => [
          [
            'scope' => 'channel',
            'source' => ['in' => 'path', 'name' => 'channelId'],
            'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/channels/member/scopes/channel'],
          ],
        ],
        'requires' => [],
        'bindings' => [],
        'responses' => [
          [
            'status' => 200,
            'media' => 'application/json',
            'body' => ['kind' => 'ref', 'schema' => 'Task'],
            'shape' => 'item',
            'headers' => [],
            'origin' => [
              'layer' => 'api',
              'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/item',
            ],
            'derivedFrom' => [
              'derivation' => 'response.format',
              'from' => [['layer' => 'core', 'pointer' => '/formats/bare']],
            ],
          ],
        ],
        'errors' => [
          [
            'code' => 'api.schema_invalid',
            'roles' => [
              [
                'role' => 'schemaInvalid',
                'params' => [
                  'kind' => 'object',
                  'members' => [
                    [
                      'name' => ['kind' => 'text', 'text' => 'issues'],
                      'value' => [
                        'kind' => 'each',
                        'of' => 'issues',
                        'as' => [
                          'kind' => 'object',
                          'members' => [
                            [
                              'name' => ['kind' => 'text', 'text' => 'pointer'],
                              'value' => [
                                'kind' => 'slot',
                                'slot' => 'item',
                                'path' => ['pointer'],
                              ],
                            ],
                            [
                              'name' => ['kind' => 'text', 'text' => 'rule'],
                              'value' => [
                                'kind' => 'slot',
                                'slot' => 'item',
                                'path' => ['rule'],
                              ],
                            ],
                          ],
                        ],
                      ],
                    ],
                  ],
                ],
              ],
            ],
            'derivedFrom' => [
              'derivation' => 'input.invalid',
              'from' => [
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/get',
                ],
                ['layer' => 'shared', 'pointer' => '/conventions/errors/derived/schemaInvalid'],
              ],
            ],
          ],
          [
            'code' => 'api.unauthenticated',
            'roles' => [['role' => 'unauthenticated']],
            'derivedFrom' => [
              'derivation' => 'identity.authenticate',
              'from' => [['layer' => 'api', 'pointer' => '/surfaces/app/identity']],
            ],
          ],
          [
            'code' => 'api.not_found',
            'roles' => [['role' => 'notFound']],
            'derivedFrom' => [
              'derivation' => 'member.notFound',
              'from' => [
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/get',
                ],
                ['layer' => 'api', 'pointer' => '/surfaces/app/routes/channels/member/scopes/channel'],
              ],
            ],
          ],
          [
            'code' => 'api.internal',
            'roles' => [['role' => 'undeclaredStatus']],
            'derivedFrom' => [
              'derivation' => 'response.undeclared',
              'from' => [
                ['layer' => 'shared', 'pointer' => '/conventions/errors/every/0'],
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/get',
                ],
              ],
            ],
          ],
        ],
        'fieldRights' => [
          [
            'schema' => 'Task',
            'pointer' => '/effort',
            'right' => 'tasks.seeEffort',
            'subject' => ['source' => ['in' => 'holderField', 'name' => 'taskId']],
            'direction' => 'output',
            'derivedFrom' => [
              'derivation' => 'fieldRight.restricted',
              'from' => [['layer' => 'shared', 'pointer' => '/schemas/Task/properties/effort/restrictedTo']],
            ],
          ],
        ],
        'upstream' => [],
        'maturity' => [
          'level' => 'provisional',
          'source' => 'api',
          'origin' => ['layer' => 'api', 'pointer' => '/api/maturity'],
        ],
        'internal' => false,
        'format' => 'bare',
        'tags' => [],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/get'],
      ],
      [
        'kind' => 'httpOperation',
        'id' => 'getTasksBatch',
        'name' => ['segments' => ['get', 'tasks', 'batch'], 'role' => 'operation'],
        'surface' => 'app',
        'op' => 'batch',
        'resource' => ['type' => 'tasks', 'idProperty' => 'taskId'],
        'features' => [],
        'method' => 'post',
        'path' => '/v1/channels/{channelId}/tasks/batch',
        'safe' => true,
        'params' => [
          'path' => [
            [
              'name' => 'channelId',
              'type' => ['kind' => 'scalar', 'type' => 'string', 'format' => 'uuid', 'refinements' => []],
              'required' => true,
              'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/channels/id/channelId'],
            ],
          ],
          'query' => [],
          'header' => [
            [
              'name' => 'Authorization',
              'type' => ['kind' => 'scalar', 'type' => 'string', 'refinements' => []],
              'required' => false,
              'derivedFrom' => [
                'derivation' => 'identity.authenticate',
                'from' => [
                  ['layer' => 'api', 'pointer' => '/surfaces/app/identity'],
                  ['layer' => 'shared', 'pointer' => '/schemes/bearer'],
                ],
              ],
            ],
          ],
        ],
        'unknownQuery' => ['policy' => 'refuse'],
        'access' => [
          'kind' => 'identity',
          'identity' => 'user',
          'schemes' => ['bearer', 'sessionCookie'],
          'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/identity'],
        ],
        'callerKinds' => ['identified'],
        'principalRequires' => [],
        'scopes' => [
          [
            'scope' => 'channel',
            'source' => ['in' => 'path', 'name' => 'channelId'],
            'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/channels/member/scopes/channel'],
          ],
        ],
        'requires' => [],
        'bindings' => [],
        'input' => [
          'media' => 'application/json',
          'schema' => ['kind' => 'ref', 'schema' => 'GetTasksBatchInput'],
          'bodyLimitBytes' => 2097152,
          'rawBody' => false,
          'origin' => [
            'layer' => 'api',
            'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/batch',
          ],
        ],
        'responses' => [
          [
            'status' => 200,
            'media' => 'application/json',
            'body' => ['kind' => 'ref', 'schema' => 'Task'],
            'shape' => 'table',
            'headers' => [],
            'derivedFrom' => [
              'derivation' => 'batch.read',
              'from' => [
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/batch',
                ],
              ],
            ],
          ],
        ],
        'errors' => [
          [
            'code' => 'api.schema_invalid',
            'roles' => [
              [
                'role' => 'schemaInvalid',
                'params' => [
                  'kind' => 'object',
                  'members' => [
                    [
                      'name' => ['kind' => 'text', 'text' => 'issues'],
                      'value' => [
                        'kind' => 'each',
                        'of' => 'issues',
                        'as' => [
                          'kind' => 'object',
                          'members' => [
                            [
                              'name' => ['kind' => 'text', 'text' => 'pointer'],
                              'value' => [
                                'kind' => 'slot',
                                'slot' => 'item',
                                'path' => ['pointer'],
                              ],
                            ],
                            [
                              'name' => ['kind' => 'text', 'text' => 'rule'],
                              'value' => [
                                'kind' => 'slot',
                                'slot' => 'item',
                                'path' => ['rule'],
                              ],
                            ],
                          ],
                        ],
                      ],
                    ],
                  ],
                ],
              ],
            ],
            'derivedFrom' => [
              'derivation' => 'input.invalid',
              'from' => [
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/batch',
                ],
                ['layer' => 'shared', 'pointer' => '/conventions/errors/derived/schemaInvalid'],
              ],
            ],
          ],
          [
            'code' => 'api.unauthenticated',
            'roles' => [['role' => 'unauthenticated']],
            'derivedFrom' => [
              'derivation' => 'identity.authenticate',
              'from' => [['layer' => 'api', 'pointer' => '/surfaces/app/identity']],
            ],
          ],
          [
            'code' => 'api.not_found',
            'derivedFrom' => [
              'derivation' => 'scope.errors',
              'from' => [
                ['layer' => 'api', 'pointer' => '/surfaces/app/routes/channels/member/scopes/channel'],
              ],
            ],
          ],
          [
            'code' => 'api.payload_too_large',
            'roles' => [
              [
                'role' => 'payloadTooLarge',
                'params' => [
                  'kind' => 'object',
                  'members' => [
                    [
                      'name' => ['kind' => 'text', 'text' => 'limitBytes'],
                      'value' => ['kind' => 'slot', 'slot' => 'limitBytes', 'path' => []],
                    ],
                  ],
                ],
              ],
            ],
            'derivedFrom' => [
              'derivation' => 'body.limit',
              'from' => [
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/batch',
                ],
              ],
            ],
          ],
          [
            'code' => 'api.unsupported_media_type',
            'roles' => [['role' => 'unsupportedMediaType']],
            'derivedFrom' => [
              'derivation' => 'body.media',
              'from' => [
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/batch',
                ],
              ],
            ],
          ],
          [
            'code' => 'api.internal',
            'roles' => [['role' => 'undeclaredStatus']],
            'derivedFrom' => [
              'derivation' => 'response.undeclared',
              'from' => [
                ['layer' => 'shared', 'pointer' => '/conventions/errors/every/0'],
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/batch',
                ],
              ],
            ],
          ],
        ],
        'fieldRights' => [
          [
            'schema' => 'Task',
            'pointer' => '/effort',
            'right' => 'tasks.seeEffort',
            'subject' => ['source' => ['in' => 'holderField', 'name' => 'taskId']],
            'direction' => 'output',
            'derivedFrom' => [
              'derivation' => 'fieldRight.restricted',
              'from' => [['layer' => 'shared', 'pointer' => '/schemas/Task/properties/effort/restrictedTo']],
            ],
          ],
        ],
        'upstream' => [],
        'maturity' => [
          'level' => 'provisional',
          'source' => 'api',
          'origin' => ['layer' => 'api', 'pointer' => '/api/maturity'],
        ],
        'internal' => false,
        'format' => 'bare',
        'tags' => [],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/batch'],
      ],
      [
        'kind' => 'httpOperation',
        'id' => 'health',
        'name' => ['segments' => ['health'], 'role' => 'operation'],
        'surface' => 'app',
        'features' => [],
        'method' => 'get',
        'path' => '/v1/health',
        'safe' => true,
        'params' => ['path' => [], 'query' => [], 'header' => []],
        'unknownQuery' => ['policy' => 'refuse'],
        'access' => [
          'kind' => 'public',
          'reason' => 'Probes call it before any user exists.',
          'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/health/access'],
        ],
        'callerKinds' => ['anonymous'],
        'principalRequires' => [],
        'scopes' => [],
        'requires' => [],
        'bindings' => [],
        'responses' => [
          [
            'status' => 200,
            'media' => 'application/json',
            'body' => ['kind' => 'ref', 'schema' => 'Health'],
            'shape' => 'item',
            'headers' => [],
            'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/health/output'],
            'derivedFrom' => [
              'derivation' => 'response.format',
              'from' => [['layer' => 'core', 'pointer' => '/formats/bare']],
            ],
          ],
        ],
        'errors' => [
          [
            'code' => 'api.schema_invalid',
            'roles' => [
              [
                'role' => 'schemaInvalid',
                'params' => [
                  'kind' => 'object',
                  'members' => [
                    [
                      'name' => ['kind' => 'text', 'text' => 'issues'],
                      'value' => [
                        'kind' => 'each',
                        'of' => 'issues',
                        'as' => [
                          'kind' => 'object',
                          'members' => [
                            [
                              'name' => ['kind' => 'text', 'text' => 'pointer'],
                              'value' => [
                                'kind' => 'slot',
                                'slot' => 'item',
                                'path' => ['pointer'],
                              ],
                            ],
                            [
                              'name' => ['kind' => 'text', 'text' => 'rule'],
                              'value' => [
                                'kind' => 'slot',
                                'slot' => 'item',
                                'path' => ['rule'],
                              ],
                            ],
                          ],
                        ],
                      ],
                    ],
                  ],
                ],
              ],
            ],
            'derivedFrom' => [
              'derivation' => 'input.invalid',
              'from' => [
                ['layer' => 'api', 'pointer' => '/surfaces/app/routes/health'],
                ['layer' => 'shared', 'pointer' => '/conventions/errors/derived/schemaInvalid'],
              ],
            ],
          ],
          [
            'code' => 'api.internal',
            'roles' => [['role' => 'undeclaredStatus']],
            'derivedFrom' => [
              'derivation' => 'response.undeclared',
              'from' => [
                ['layer' => 'shared', 'pointer' => '/conventions/errors/every/0'],
                ['layer' => 'api', 'pointer' => '/surfaces/app/routes/health'],
              ],
            ],
          ],
        ],
        'fieldRights' => [],
        'upstream' => [],
        'maturity' => [
          'level' => 'provisional',
          'source' => 'api',
          'origin' => ['layer' => 'api', 'pointer' => '/api/maturity'],
        ],
        'internal' => false,
        'format' => 'bare',
        'tags' => [],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/health'],
      ],
      [
        'kind' => 'httpOperation',
        'id' => 'listTasks',
        'name' => ['segments' => ['list', 'tasks'], 'role' => 'operation'],
        'surface' => 'app',
        'op' => 'list',
        'resource' => ['type' => 'tasks', 'idProperty' => 'taskId'],
        'features' => [],
        'method' => 'get',
        'path' => '/v1/channels/{channelId}/tasks',
        'safe' => true,
        'params' => [
          'path' => [
            [
              'name' => 'channelId',
              'type' => ['kind' => 'scalar', 'type' => 'string', 'format' => 'uuid', 'refinements' => []],
              'required' => true,
              'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/channels/id/channelId'],
            ],
          ],
          'query' => [
            [
              'name' => 'cursor',
              'type' => ['kind' => 'scalar', 'type' => 'string', 'refinements' => []],
              'required' => false,
              'wire' => ['kind' => 'text', 'style' => 'form', 'explode' => true, 'brackets' => false],
              'derivedFrom' => [
                'derivation' => 'paging.params',
                'from' => [
                  [
                    'layer' => 'api',
                    'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/list/paging',
                  ],
                  ['layer' => 'shared', 'pointer' => '/pagings/cursor'],
                ],
              ],
            ],
            [
              'name' => 'limit',
              'type' => [
                'kind' => 'scalar',
                'type' => 'integer',
                'refinements' => ['minimum' => '1', 'maximum' => '50'],
              ],
              'required' => false,
              'wire' => ['kind' => 'number', 'style' => 'form', 'explode' => true, 'brackets' => false],
              'derivedFrom' => [
                'derivation' => 'paging.params',
                'from' => [
                  [
                    'layer' => 'api',
                    'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/list/paging',
                  ],
                  ['layer' => 'shared', 'pointer' => '/pagings/cursor'],
                ],
              ],
            ],
            [
              'name' => 'sort',
              'type' => [
                'kind' => 'array',
                'items' => [
                  'kind' => 'scalar',
                  'type' => 'string',
                  'refinements' => [
                    'pattern' => [
                      'source' => '^(?:createdAt|-createdAt)$',
                      'normalized' => '^(?:createdAt|-createdAt)$',
                    ],
                  ],
                ],
              ],
              'required' => false,
              'wire' => ['kind' => 'list', 'style' => 'form', 'explode' => false, 'brackets' => false],
              'derivedFrom' => [
                'derivation' => 'paging.params',
                'from' => [
                  [
                    'layer' => 'api',
                    'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/list/paging',
                  ],
                  ['layer' => 'shared', 'pointer' => '/pagings/cursor'],
                ],
              ],
            ],
          ],
          'header' => [
            [
              'name' => 'Authorization',
              'type' => ['kind' => 'scalar', 'type' => 'string', 'refinements' => []],
              'required' => false,
              'derivedFrom' => [
                'derivation' => 'identity.authenticate',
                'from' => [
                  ['layer' => 'api', 'pointer' => '/surfaces/app/identity'],
                  ['layer' => 'shared', 'pointer' => '/schemes/bearer'],
                ],
              ],
            ],
          ],
        ],
        'unknownQuery' => ['policy' => 'refuse'],
        'access' => [
          'kind' => 'identity',
          'identity' => 'user',
          'schemes' => ['bearer', 'sessionCookie'],
          'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/identity'],
        ],
        'callerKinds' => ['identified'],
        'principalRequires' => [],
        'scopes' => [
          [
            'scope' => 'channel',
            'source' => ['in' => 'path', 'name' => 'channelId'],
            'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/channels/member/scopes/channel'],
          ],
        ],
        'requires' => [],
        'bindings' => [],
        'responses' => [
          [
            'status' => 200,
            'media' => 'application/json',
            'body' => ['kind' => 'ref', 'schema' => 'Task'],
            'shape' => 'page',
            'headers' => [
              [
                'name' => 'Link',
                'type' => ['kind' => 'scalar', 'type' => 'string', 'refinements' => []],
                'required' => false,
                'derivedFrom' => [
                  'derivation' => 'paging.params',
                  'from' => [
                    [
                      'layer' => 'api',
                      'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/list/paging',
                    ],
                    ['layer' => 'shared', 'pointer' => '/pagings/cursor'],
                  ],
                ],
              ],
            ],
            'origin' => [
              'layer' => 'api',
              'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/item',
            ],
            'derivedFrom' => [
              'derivation' => 'response.format',
              'from' => [['layer' => 'core', 'pointer' => '/formats/bare']],
            ],
          ],
        ],
        'errors' => [
          [
            'code' => 'api.schema_invalid',
            'roles' => [
              [
                'role' => 'schemaInvalid',
                'params' => [
                  'kind' => 'object',
                  'members' => [
                    [
                      'name' => ['kind' => 'text', 'text' => 'issues'],
                      'value' => [
                        'kind' => 'each',
                        'of' => 'issues',
                        'as' => [
                          'kind' => 'object',
                          'members' => [
                            [
                              'name' => ['kind' => 'text', 'text' => 'pointer'],
                              'value' => [
                                'kind' => 'slot',
                                'slot' => 'item',
                                'path' => ['pointer'],
                              ],
                            ],
                            [
                              'name' => ['kind' => 'text', 'text' => 'rule'],
                              'value' => [
                                'kind' => 'slot',
                                'slot' => 'item',
                                'path' => ['rule'],
                              ],
                            ],
                          ],
                        ],
                      ],
                    ],
                  ],
                ],
              ],
            ],
            'derivedFrom' => [
              'derivation' => 'input.invalid',
              'from' => [
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/list',
                ],
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/list/paging',
                ],
                ['layer' => 'shared', 'pointer' => '/conventions/errors/derived/schemaInvalid'],
              ],
            ],
          ],
          [
            'code' => 'api.unauthenticated',
            'roles' => [['role' => 'unauthenticated']],
            'derivedFrom' => [
              'derivation' => 'identity.authenticate',
              'from' => [['layer' => 'api', 'pointer' => '/surfaces/app/identity']],
            ],
          ],
          [
            'code' => 'api.not_found',
            'derivedFrom' => [
              'derivation' => 'scope.errors',
              'from' => [
                ['layer' => 'api', 'pointer' => '/surfaces/app/routes/channels/member/scopes/channel'],
              ],
            ],
          ],
          [
            'code' => 'api.internal',
            'roles' => [['role' => 'undeclaredStatus']],
            'derivedFrom' => [
              'derivation' => 'response.undeclared',
              'from' => [
                ['layer' => 'shared', 'pointer' => '/conventions/errors/every/0'],
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/list',
                ],
              ],
            ],
          ],
        ],
        'fieldRights' => [
          [
            'schema' => 'Task',
            'pointer' => '/effort',
            'right' => 'tasks.seeEffort',
            'subject' => ['source' => ['in' => 'holderField', 'name' => 'taskId']],
            'direction' => 'output',
            'derivedFrom' => [
              'derivation' => 'fieldRight.restricted',
              'from' => [['layer' => 'shared', 'pointer' => '/schemas/Task/properties/effort/restrictedTo']],
            ],
          ],
        ],
        'paging' => [
          'style' => 'cursor',
          'maxLimit' => 50,
          'defaultLimit' => 50,
          'overLimit' => 'reject',
          'sortKeys' => [
            [
              'key' => 'createdAt',
              'origin' => [
                'layer' => 'api',
                'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/list/sortable/0',
              ],
            ],
          ],
          'origin' => [
            'layer' => 'api',
            'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/list/paging',
          ],
        ],
        'filteredBy' => 'tasks.read',
        'upstream' => [],
        'maturity' => [
          'level' => 'provisional',
          'source' => 'api',
          'origin' => ['layer' => 'api', 'pointer' => '/api/maturity'],
        ],
        'internal' => false,
        'format' => 'bare',
        'tags' => [],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/list'],
      ],
      [
        'kind' => 'httpOperation',
        'id' => 'payments',
        'name' => ['segments' => ['payments'], 'role' => 'operation'],
        'surface' => 'hooks',
        'features' => [],
        'method' => 'post',
        'path' => '/v1/hooks/payments',
        'safe' => false,
        'params' => [
          'path' => [],
          'query' => [],
          'header' => [
            [
              'name' => 'Stripe-Signature',
              'type' => ['kind' => 'scalar', 'type' => 'string', 'refinements' => []],
              'required' => true,
              'derivedFrom' => [
                'derivation' => 'identity.authenticate',
                'from' => [
                  ['layer' => 'api', 'pointer' => '/surfaces/hooks/identity'],
                  ['layer' => 'shared', 'pointer' => '/schemes/stripeSignature'],
                ],
              ],
            ],
          ],
        ],
        'unknownQuery' => ['policy' => 'refuse'],
        'access' => [
          'kind' => 'identity',
          'identity' => 'stripe',
          'schemes' => ['stripeSignature'],
          'origin' => ['layer' => 'api', 'pointer' => '/surfaces/hooks/identity'],
        ],
        'callerKinds' => ['identified'],
        'principalRequires' => [],
        'scopes' => [],
        'requires' => [],
        'bindings' => [],
        'input' => [
          'media' => 'application/json',
          'schema' => ['kind' => 'ref', 'schema' => 'PaymentEvent'],
          'bodyLimitBytes' => 1048576,
          'rawBody' => true,
          'origin' => ['layer' => 'api', 'pointer' => '/surfaces/hooks/routes/payments/input'],
        ],
        'responses' => [
          [
            'status' => 204,
            'shape' => 'empty',
            'headers' => [],
            'origin' => ['layer' => 'api', 'pointer' => '/surfaces/hooks/routes/payments/responses/204'],
            'derivedFrom' => [
              'derivation' => 'response.format',
              'from' => [['layer' => 'core', 'pointer' => '/formats/bare']],
            ],
          ],
        ],
        'errors' => [
          [
            'code' => 'api.schema_invalid',
            'roles' => [
              [
                'role' => 'schemaInvalid',
                'params' => [
                  'kind' => 'object',
                  'members' => [
                    [
                      'name' => ['kind' => 'text', 'text' => 'issues'],
                      'value' => [
                        'kind' => 'each',
                        'of' => 'issues',
                        'as' => [
                          'kind' => 'object',
                          'members' => [
                            [
                              'name' => ['kind' => 'text', 'text' => 'pointer'],
                              'value' => [
                                'kind' => 'slot',
                                'slot' => 'item',
                                'path' => ['pointer'],
                              ],
                            ],
                            [
                              'name' => ['kind' => 'text', 'text' => 'rule'],
                              'value' => [
                                'kind' => 'slot',
                                'slot' => 'item',
                                'path' => ['rule'],
                              ],
                            ],
                          ],
                        ],
                      ],
                    ],
                  ],
                ],
              ],
            ],
            'derivedFrom' => [
              'derivation' => 'input.invalid',
              'from' => [
                ['layer' => 'api', 'pointer' => '/surfaces/hooks/routes/payments'],
                ['layer' => 'shared', 'pointer' => '/conventions/errors/derived/schemaInvalid'],
              ],
            ],
          ],
          [
            'code' => 'api.unauthenticated',
            'roles' => [['role' => 'unauthenticated']],
            'derivedFrom' => [
              'derivation' => 'identity.authenticate',
              'from' => [
                ['layer' => 'shared', 'pointer' => '/identities/stripe'],
                ['layer' => 'api', 'pointer' => '/surfaces/hooks/identity'],
              ],
            ],
          ],
          [
            'code' => 'api.payload_too_large',
            'roles' => [
              [
                'role' => 'payloadTooLarge',
                'params' => [
                  'kind' => 'object',
                  'members' => [
                    [
                      'name' => ['kind' => 'text', 'text' => 'limitBytes'],
                      'value' => ['kind' => 'slot', 'slot' => 'limitBytes', 'path' => []],
                    ],
                  ],
                ],
              ],
            ],
            'derivedFrom' => [
              'derivation' => 'body.limit',
              'from' => [['layer' => 'api', 'pointer' => '/surfaces/hooks/routes/payments/input']],
            ],
          ],
          [
            'code' => 'api.unsupported_media_type',
            'roles' => [['role' => 'unsupportedMediaType']],
            'derivedFrom' => [
              'derivation' => 'body.media',
              'from' => [['layer' => 'api', 'pointer' => '/surfaces/hooks/routes/payments/input']],
            ],
          ],
          [
            'code' => 'api.internal',
            'roles' => [['role' => 'undeclaredStatus']],
            'derivedFrom' => [
              'derivation' => 'response.undeclared',
              'from' => [
                ['layer' => 'shared', 'pointer' => '/conventions/errors/every/0'],
                ['layer' => 'api', 'pointer' => '/surfaces/hooks/routes/payments'],
              ],
            ],
          ],
        ],
        'fieldRights' => [],
        'upstream' => [],
        'maturity' => [
          'level' => 'provisional',
          'source' => 'api',
          'origin' => ['layer' => 'api', 'pointer' => '/api/maturity'],
        ],
        'internal' => false,
        'format' => 'bare',
        'tags' => [],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'api', 'pointer' => '/surfaces/hooks/routes/payments'],
      ],
      [
        'kind' => 'httpOperation',
        'id' => 'purgeTask',
        'name' => ['segments' => ['purge', 'task'], 'role' => 'operation'],
        'surface' => 'app',
        'resource' => ['type' => 'tasks', 'idParam' => 'taskId', 'idProperty' => 'taskId'],
        'features' => [],
        'method' => 'post',
        'path' => '/v1/channels/{channelId}/tasks/{taskId}/purge',
        'safe' => false,
        'params' => [
          'path' => [
            [
              'name' => 'channelId',
              'type' => ['kind' => 'scalar', 'type' => 'string', 'format' => 'uuid', 'refinements' => []],
              'required' => true,
              'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/channels/id/channelId'],
            ],
            [
              'name' => 'taskId',
              'type' => ['kind' => 'scalar', 'type' => 'string', 'format' => 'uuid', 'refinements' => []],
              'required' => true,
              'origin' => [
                'layer' => 'api',
                'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/id/taskId',
              ],
            ],
          ],
          'query' => [],
          'header' => [
            [
              'name' => 'Authorization',
              'type' => ['kind' => 'scalar', 'type' => 'string', 'refinements' => []],
              'required' => false,
              'derivedFrom' => [
                'derivation' => 'identity.authenticate',
                'from' => [
                  ['layer' => 'api', 'pointer' => '/surfaces/app/identity'],
                  ['layer' => 'shared', 'pointer' => '/schemes/bearer'],
                ],
              ],
            ],
            [
              'name' => 'X-Csrf-Token',
              'type' => ['kind' => 'scalar', 'type' => 'string', 'refinements' => []],
              'required' => false,
              'derivedFrom' => [
                'derivation' => 'csrf.cookieWrite',
                'from' => [
                  ['layer' => 'shared', 'pointer' => '/identities/user'],
                  ['layer' => 'shared', 'pointer' => '/schemes/sessionCookie'],
                ],
              ],
            ],
            [
              'name' => 'Idempotency-Key',
              'type' => ['kind' => 'scalar', 'type' => 'string', 'refinements' => []],
              'required' => true,
              'derivedFrom' => [
                'derivation' => 'idempotency.write',
                'from' => [['layer' => 'shared', 'pointer' => '/conventions/idempotency']],
              ],
            ],
          ],
        ],
        'unknownQuery' => ['policy' => 'refuse'],
        'access' => [
          'kind' => 'identity',
          'identity' => 'user',
          'schemes' => ['bearer', 'sessionCookie'],
          'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/identity'],
        ],
        'callerKinds' => ['identified'],
        'principalRequires' => [],
        'scopes' => [
          [
            'scope' => 'channel',
            'source' => ['in' => 'path', 'name' => 'channelId'],
            'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/channels/member/scopes/channel'],
          ],
        ],
        'requires' => [
          [
            'kind' => 'rule',
            'rule' => 'recentAuth',
            'params' => ['intent' => 'purge_task'],
            'origin' => [
              'layer' => 'api',
              'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/member/routes/purge/requires/0',
            ],
          ],
        ],
        'bindings' => [],
        'input' => [
          'media' => 'application/json',
          'schema' => ['kind' => 'ref', 'schema' => 'ApiEmptyBody'],
          'bodyLimitBytes' => 1048576,
          'rawBody' => false,
          'proofs' => [
            [
              'name' => 'reauthToken',
              'schema' => [
                'kind' => 'scalar',
                'type' => 'string',
                'refinements' => ['minLength' => 1, 'maxLength' => 512],
              ],
              'derivedFrom' => [
                'derivation' => 'rule.proof',
                'from' => [
                  [
                    'layer' => 'api',
                    'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/member/routes/purge/requires/0',
                  ],
                  ['layer' => 'shared', 'pointer' => '/rules/recentAuth/proof'],
                ],
              ],
            ],
          ],
          'origin' => [
            'layer' => 'api',
            'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/member/routes/purge/requires/0',
          ],
        ],
        'responses' => [
          [
            'status' => 204,
            'shape' => 'empty',
            'headers' => [
              [
                'name' => 'Idempotency-Replayed',
                'type' => ['kind' => 'scalar', 'type' => 'boolean', 'refinements' => []],
                'required' => false,
                'derivedFrom' => [
                  'derivation' => 'idempotency.write',
                  'from' => [['layer' => 'shared', 'pointer' => '/conventions/idempotency']],
                ],
              ],
            ],
            'origin' => [
              'layer' => 'api',
              'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/member/routes/purge/responses/204',
            ],
            'derivedFrom' => [
              'derivation' => 'response.format',
              'from' => [['layer' => 'core', 'pointer' => '/formats/bare']],
            ],
          ],
        ],
        'errors' => [
          [
            'code' => 'api.schema_invalid',
            'roles' => [
              [
                'role' => 'schemaInvalid',
                'params' => [
                  'kind' => 'object',
                  'members' => [
                    [
                      'name' => ['kind' => 'text', 'text' => 'issues'],
                      'value' => [
                        'kind' => 'each',
                        'of' => 'issues',
                        'as' => [
                          'kind' => 'object',
                          'members' => [
                            [
                              'name' => ['kind' => 'text', 'text' => 'pointer'],
                              'value' => [
                                'kind' => 'slot',
                                'slot' => 'item',
                                'path' => ['pointer'],
                              ],
                            ],
                            [
                              'name' => ['kind' => 'text', 'text' => 'rule'],
                              'value' => [
                                'kind' => 'slot',
                                'slot' => 'item',
                                'path' => ['rule'],
                              ],
                            ],
                          ],
                        ],
                      ],
                    ],
                  ],
                ],
              ],
            ],
            'derivedFrom' => [
              'derivation' => 'input.invalid',
              'from' => [
                ['layer' => 'shared', 'pointer' => '/conventions/idempotency'],
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/member/routes/purge',
                ],
                ['layer' => 'shared', 'pointer' => '/conventions/errors/derived/schemaInvalid'],
              ],
            ],
          ],
          [
            'code' => 'api.reauthentication_required',
            'derivedFrom' => [
              'derivation' => 'requirement.errors',
              'from' => [
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/member/routes/purge/requires/0',
                ],
              ],
            ],
          ],
          [
            'code' => 'api.unauthenticated',
            'roles' => [['role' => 'unauthenticated']],
            'derivedFrom' => [
              'derivation' => 'identity.authenticate',
              'from' => [['layer' => 'api', 'pointer' => '/surfaces/app/identity']],
            ],
          ],
          [
            'code' => 'api.csrf_invalid',
            'roles' => [['role' => 'csrfInvalid']],
            'derivedFrom' => [
              'derivation' => 'csrf.cookieWrite',
              'from' => [
                ['layer' => 'shared', 'pointer' => '/identities/user'],
                ['layer' => 'shared', 'pointer' => '/schemes/sessionCookie'],
              ],
            ],
          ],
          [
            'code' => 'api.not_found',
            'roles' => [['role' => 'notFound']],
            'derivedFrom' => [
              'derivation' => 'member.notFound',
              'from' => [
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/member/routes/purge',
                ],
                ['layer' => 'api', 'pointer' => '/surfaces/app/routes/channels/member/scopes/channel'],
              ],
            ],
          ],
          [
            'code' => 'api.idempotency_in_progress',
            'roles' => [['role' => 'idempotencyInProgress']],
            'derivedFrom' => [
              'derivation' => 'idempotency.write',
              'from' => [['layer' => 'shared', 'pointer' => '/conventions/idempotency']],
            ],
          ],
          [
            'code' => 'api.payload_too_large',
            'roles' => [
              [
                'role' => 'payloadTooLarge',
                'params' => [
                  'kind' => 'object',
                  'members' => [
                    [
                      'name' => ['kind' => 'text', 'text' => 'limitBytes'],
                      'value' => ['kind' => 'slot', 'slot' => 'limitBytes', 'path' => []],
                    ],
                  ],
                ],
              ],
            ],
            'derivedFrom' => [
              'derivation' => 'body.limit',
              'from' => [
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/member/routes/purge/requires/0',
                ],
              ],
            ],
          ],
          [
            'code' => 'api.unsupported_media_type',
            'roles' => [['role' => 'unsupportedMediaType']],
            'derivedFrom' => [
              'derivation' => 'body.media',
              'from' => [
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/member/routes/purge/requires/0',
                ],
              ],
            ],
          ],
          [
            'code' => 'api.idempotency_key_reused',
            'roles' => [['role' => 'idempotencyKeyReused']],
            'derivedFrom' => [
              'derivation' => 'idempotency.write',
              'from' => [['layer' => 'shared', 'pointer' => '/conventions/idempotency']],
            ],
          ],
          [
            'code' => 'api.internal',
            'roles' => [['role' => 'undeclaredStatus']],
            'derivedFrom' => [
              'derivation' => 'response.undeclared',
              'from' => [
                ['layer' => 'shared', 'pointer' => '/conventions/errors/every/0'],
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/member/routes/purge',
                ],
              ],
            ],
          ],
        ],
        'fieldRights' => [],
        'idempotency' => [
          'kind' => 'derived',
          'header' => 'Idempotency-Key',
          'replayHeader' => 'Idempotency-Replayed',
          'lifetimeMs' => 86400000,
          'required' => true,
          'enforce' => 'boundary',
          'derivedFrom' => [
            'derivation' => 'idempotency.write',
            'from' => [['layer' => 'shared', 'pointer' => '/conventions/idempotency']],
          ],
        ],
        'upstream' => [],
        'maturity' => [
          'level' => 'provisional',
          'source' => 'api',
          'origin' => ['layer' => 'api', 'pointer' => '/api/maturity'],
        ],
        'internal' => false,
        'csrf' => [
          'kind' => 'derived',
          'header' => 'X-Csrf-Token',
          'derivedFrom' => [
            'derivation' => 'csrf.cookieWrite',
            'from' => [
              ['layer' => 'shared', 'pointer' => '/identities/user'],
              ['layer' => 'shared', 'pointer' => '/schemes/sessionCookie'],
            ],
          ],
        ],
        'format' => 'bare',
        'tags' => [],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => [
          'layer' => 'api',
          'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/member/routes/purge',
        ],
      ],
      [
        'kind' => 'httpOperation',
        'id' => 'searchTasks',
        'name' => ['segments' => ['search', 'tasks'], 'role' => 'operation'],
        'surface' => 'app',
        'resource' => ['type' => 'tasks', 'idProperty' => 'taskId'],
        'features' => [],
        'method' => 'post',
        'path' => '/v1/channels/{channelId}/tasks/search',
        'safe' => false,
        'params' => [
          'path' => [
            [
              'name' => 'channelId',
              'type' => ['kind' => 'scalar', 'type' => 'string', 'format' => 'uuid', 'refinements' => []],
              'required' => true,
              'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/channels/id/channelId'],
            ],
          ],
          'query' => [],
          'header' => [
            [
              'name' => 'Authorization',
              'type' => ['kind' => 'scalar', 'type' => 'string', 'refinements' => []],
              'required' => false,
              'derivedFrom' => [
                'derivation' => 'identity.authenticate',
                'from' => [
                  ['layer' => 'api', 'pointer' => '/surfaces/app/identity'],
                  ['layer' => 'shared', 'pointer' => '/schemes/bearer'],
                ],
              ],
            ],
            [
              'name' => 'X-Csrf-Token',
              'type' => ['kind' => 'scalar', 'type' => 'string', 'refinements' => []],
              'required' => false,
              'derivedFrom' => [
                'derivation' => 'csrf.cookieWrite',
                'from' => [
                  ['layer' => 'shared', 'pointer' => '/identities/user'],
                  ['layer' => 'shared', 'pointer' => '/schemes/sessionCookie'],
                ],
              ],
            ],
          ],
        ],
        'unknownQuery' => ['policy' => 'refuse'],
        'access' => [
          'kind' => 'identity',
          'identity' => 'user',
          'schemes' => ['bearer', 'sessionCookie'],
          'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/identity'],
        ],
        'callerKinds' => ['identified'],
        'principalRequires' => [],
        'scopes' => [
          [
            'scope' => 'channel',
            'source' => ['in' => 'path', 'name' => 'channelId'],
            'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/channels/member/scopes/channel'],
          ],
        ],
        'requires' => [
          [
            'kind' => 'right',
            'right' => 'tasks.read',
            'subject' => ['source' => ['in' => 'scope', 'name' => 'channel'], 'defaulted' => true],
            'origin' => [
              'layer' => 'api',
              'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/collection/routes/search/requires/0',
            ],
          ],
        ],
        'bindings' => [],
        'input' => [
          'media' => 'application/json',
          'schema' => ['kind' => 'ref', 'schema' => 'TaskQuery'],
          'bodyLimitBytes' => 1048576,
          'rawBody' => false,
          'origin' => [
            'layer' => 'api',
            'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/collection/routes/search/input',
          ],
        ],
        'responses' => [
          [
            'status' => 200,
            'media' => 'application/json',
            'body' => ['kind' => 'ref', 'schema' => 'TaskSearchResult'],
            'shape' => 'item',
            'headers' => [],
            'origin' => [
              'layer' => 'api',
              'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/collection/routes/search/output',
            ],
            'derivedFrom' => [
              'derivation' => 'response.format',
              'from' => [['layer' => 'core', 'pointer' => '/formats/bare']],
            ],
          ],
        ],
        'errors' => [
          [
            'code' => 'api.schema_invalid',
            'roles' => [
              [
                'role' => 'schemaInvalid',
                'params' => [
                  'kind' => 'object',
                  'members' => [
                    [
                      'name' => ['kind' => 'text', 'text' => 'issues'],
                      'value' => [
                        'kind' => 'each',
                        'of' => 'issues',
                        'as' => [
                          'kind' => 'object',
                          'members' => [
                            [
                              'name' => ['kind' => 'text', 'text' => 'pointer'],
                              'value' => [
                                'kind' => 'slot',
                                'slot' => 'item',
                                'path' => ['pointer'],
                              ],
                            ],
                            [
                              'name' => ['kind' => 'text', 'text' => 'rule'],
                              'value' => [
                                'kind' => 'slot',
                                'slot' => 'item',
                                'path' => ['rule'],
                              ],
                            ],
                          ],
                        ],
                      ],
                    ],
                  ],
                ],
              ],
            ],
            'derivedFrom' => [
              'derivation' => 'input.invalid',
              'from' => [
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/collection/routes/search',
                ],
                ['layer' => 'shared', 'pointer' => '/conventions/errors/derived/schemaInvalid'],
              ],
            ],
          ],
          [
            'code' => 'api.unauthenticated',
            'roles' => [['role' => 'unauthenticated']],
            'derivedFrom' => [
              'derivation' => 'identity.authenticate',
              'from' => [['layer' => 'api', 'pointer' => '/surfaces/app/identity']],
            ],
          ],
          [
            'code' => 'api.csrf_invalid',
            'roles' => [['role' => 'csrfInvalid']],
            'derivedFrom' => [
              'derivation' => 'csrf.cookieWrite',
              'from' => [
                ['layer' => 'shared', 'pointer' => '/identities/user'],
                ['layer' => 'shared', 'pointer' => '/schemes/sessionCookie'],
              ],
            ],
          ],
          [
            'code' => 'api.forbidden',
            'derivedFrom' => [
              'derivation' => 'requirement.errors',
              'from' => [
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/collection/routes/search/requires/0',
                ],
              ],
            ],
          ],
          [
            'code' => 'api.not_found',
            'derivedFrom' => [
              'derivation' => 'scope.errors',
              'from' => [
                ['layer' => 'api', 'pointer' => '/surfaces/app/routes/channels/member/scopes/channel'],
              ],
            ],
          ],
          [
            'code' => 'api.payload_too_large',
            'roles' => [
              [
                'role' => 'payloadTooLarge',
                'params' => [
                  'kind' => 'object',
                  'members' => [
                    [
                      'name' => ['kind' => 'text', 'text' => 'limitBytes'],
                      'value' => ['kind' => 'slot', 'slot' => 'limitBytes', 'path' => []],
                    ],
                  ],
                ],
              ],
            ],
            'derivedFrom' => [
              'derivation' => 'body.limit',
              'from' => [
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/collection/routes/search/input',
                ],
              ],
            ],
          ],
          [
            'code' => 'api.unsupported_media_type',
            'roles' => [['role' => 'unsupportedMediaType']],
            'derivedFrom' => [
              'derivation' => 'body.media',
              'from' => [
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/collection/routes/search/input',
                ],
              ],
            ],
          ],
          [
            'code' => 'api.internal',
            'roles' => [['role' => 'undeclaredStatus']],
            'derivedFrom' => [
              'derivation' => 'response.undeclared',
              'from' => [
                ['layer' => 'shared', 'pointer' => '/conventions/errors/every/0'],
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/collection/routes/search',
                ],
              ],
            ],
          ],
        ],
        'fieldRights' => [
          [
            'schema' => 'TaskSearchResult',
            'pointer' => '/items/*/effort',
            'right' => 'tasks.seeEffort',
            'subject' => ['source' => ['in' => 'holderField', 'name' => 'taskId']],
            'direction' => 'output',
            'derivedFrom' => [
              'derivation' => 'fieldRight.restricted',
              'from' => [['layer' => 'shared', 'pointer' => '/schemas/Task/properties/effort/restrictedTo']],
            ],
          ],
        ],
        'idempotency' => [
          'kind' => 'exempt',
          'reason' => 'A read with a body; replaying it is harmless.',
          'origin' => [
            'layer' => 'api',
            'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/collection/routes/search/idempotency',
          ],
        ],
        'budgetMs' => 300,
        'upstream' => [],
        'maturity' => [
          'level' => 'provisional',
          'source' => 'api',
          'origin' => ['layer' => 'api', 'pointer' => '/api/maturity'],
        ],
        'internal' => false,
        'csrf' => [
          'kind' => 'derived',
          'header' => 'X-Csrf-Token',
          'derivedFrom' => [
            'derivation' => 'csrf.cookieWrite',
            'from' => [
              ['layer' => 'shared', 'pointer' => '/identities/user'],
              ['layer' => 'shared', 'pointer' => '/schemes/sessionCookie'],
            ],
          ],
        ],
        'format' => 'bare',
        'tags' => [],
        'examples' => [
          'firstPage' => [
            'status' => 200,
            'value' => [
              'items' => [
                [
                  'createdAt' => '2027-01-15T09:30:00Z',
                  'state' => 'open',
                  'taskId' => '6f1c2a4e-8b1d-4c3a-9f2e-1d5b7a9c0e42',
                  'title' => 'Write the brief',
                  'version' => 1,
                ],
              ],
              'total' => 1,
            ],
          ],
        ],
        'docs' => ['summary' => 'Search the channel\'s tasks with a structured query.'],
        'extensions' => [],
        'origin' => [
          'layer' => 'api',
          'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/collection/routes/search',
        ],
      ],
      [
        'kind' => 'httpOperation',
        'id' => 'updateTask',
        'name' => ['segments' => ['update', 'task'], 'role' => 'operation'],
        'surface' => 'app',
        'op' => 'update',
        'resource' => ['type' => 'tasks', 'idParam' => 'taskId', 'idProperty' => 'taskId'],
        'features' => [],
        'method' => 'patch',
        'path' => '/v1/channels/{channelId}/tasks/{taskId}',
        'safe' => false,
        'params' => [
          'path' => [
            [
              'name' => 'channelId',
              'type' => ['kind' => 'scalar', 'type' => 'string', 'format' => 'uuid', 'refinements' => []],
              'required' => true,
              'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/channels/id/channelId'],
            ],
            [
              'name' => 'taskId',
              'type' => ['kind' => 'scalar', 'type' => 'string', 'format' => 'uuid', 'refinements' => []],
              'required' => true,
              'origin' => [
                'layer' => 'api',
                'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/id/taskId',
              ],
            ],
          ],
          'query' => [],
          'header' => [
            [
              'name' => 'Authorization',
              'type' => ['kind' => 'scalar', 'type' => 'string', 'refinements' => []],
              'required' => false,
              'derivedFrom' => [
                'derivation' => 'identity.authenticate',
                'from' => [
                  ['layer' => 'api', 'pointer' => '/surfaces/app/identity'],
                  ['layer' => 'shared', 'pointer' => '/schemes/bearer'],
                ],
              ],
            ],
            [
              'name' => 'X-Csrf-Token',
              'type' => ['kind' => 'scalar', 'type' => 'string', 'refinements' => []],
              'required' => false,
              'derivedFrom' => [
                'derivation' => 'csrf.cookieWrite',
                'from' => [
                  ['layer' => 'shared', 'pointer' => '/identities/user'],
                  ['layer' => 'shared', 'pointer' => '/schemes/sessionCookie'],
                ],
              ],
            ],
            [
              'name' => 'Idempotency-Key',
              'type' => ['kind' => 'scalar', 'type' => 'string', 'refinements' => []],
              'required' => true,
              'derivedFrom' => [
                'derivation' => 'idempotency.write',
                'from' => [['layer' => 'shared', 'pointer' => '/conventions/idempotency']],
              ],
            ],
          ],
        ],
        'unknownQuery' => ['policy' => 'refuse'],
        'access' => [
          'kind' => 'identity',
          'identity' => 'user',
          'schemes' => ['bearer', 'sessionCookie'],
          'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/identity'],
        ],
        'callerKinds' => ['identified'],
        'principalRequires' => [],
        'scopes' => [
          [
            'scope' => 'channel',
            'source' => ['in' => 'path', 'name' => 'channelId'],
            'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/channels/member/scopes/channel'],
          ],
        ],
        'requires' => [
          [
            'kind' => 'right',
            'right' => 'tasks.update',
            'subject' => ['source' => ['in' => 'path', 'name' => 'taskId'], 'defaulted' => true],
            'origin' => [
              'layer' => 'api',
              'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/update/requires/0',
            ],
          ],
        ],
        'bindings' => [],
        'input' => [
          'media' => 'application/json',
          'schema' => ['kind' => 'ref', 'schema' => 'UpdateTask'],
          'bodyLimitBytes' => 1048576,
          'rawBody' => false,
          'origin' => [
            'layer' => 'api',
            'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/update/input',
          ],
        ],
        'responses' => [
          [
            'status' => 200,
            'media' => 'application/json',
            'body' => ['kind' => 'ref', 'schema' => 'Task'],
            'shape' => 'item',
            'headers' => [
              [
                'name' => 'Idempotency-Replayed',
                'type' => ['kind' => 'scalar', 'type' => 'boolean', 'refinements' => []],
                'required' => false,
                'derivedFrom' => [
                  'derivation' => 'idempotency.write',
                  'from' => [['layer' => 'shared', 'pointer' => '/conventions/idempotency']],
                ],
              ],
            ],
            'origin' => [
              'layer' => 'api',
              'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/item',
            ],
            'derivedFrom' => [
              'derivation' => 'response.format',
              'from' => [['layer' => 'core', 'pointer' => '/formats/bare']],
            ],
          ],
        ],
        'errors' => [
          [
            'code' => 'api.schema_invalid',
            'roles' => [
              [
                'role' => 'schemaInvalid',
                'params' => [
                  'kind' => 'object',
                  'members' => [
                    [
                      'name' => ['kind' => 'text', 'text' => 'issues'],
                      'value' => [
                        'kind' => 'each',
                        'of' => 'issues',
                        'as' => [
                          'kind' => 'object',
                          'members' => [
                            [
                              'name' => ['kind' => 'text', 'text' => 'pointer'],
                              'value' => [
                                'kind' => 'slot',
                                'slot' => 'item',
                                'path' => ['pointer'],
                              ],
                            ],
                            [
                              'name' => ['kind' => 'text', 'text' => 'rule'],
                              'value' => [
                                'kind' => 'slot',
                                'slot' => 'item',
                                'path' => ['rule'],
                              ],
                            ],
                          ],
                        ],
                      ],
                    ],
                  ],
                ],
              ],
            ],
            'derivedFrom' => [
              'derivation' => 'input.invalid',
              'from' => [
                ['layer' => 'shared', 'pointer' => '/conventions/idempotency'],
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/update',
                ],
                ['layer' => 'shared', 'pointer' => '/conventions/errors/derived/schemaInvalid'],
              ],
            ],
          ],
          [
            'code' => 'api.unauthenticated',
            'roles' => [['role' => 'unauthenticated']],
            'derivedFrom' => [
              'derivation' => 'identity.authenticate',
              'from' => [['layer' => 'api', 'pointer' => '/surfaces/app/identity']],
            ],
          ],
          [
            'code' => 'api.csrf_invalid',
            'roles' => [['role' => 'csrfInvalid']],
            'derivedFrom' => [
              'derivation' => 'csrf.cookieWrite',
              'from' => [
                ['layer' => 'shared', 'pointer' => '/identities/user'],
                ['layer' => 'shared', 'pointer' => '/schemes/sessionCookie'],
              ],
            ],
          ],
          [
            'code' => 'api.forbidden',
            'roles' => [
              [
                'role' => 'forbidden',
                'params' => [
                  'kind' => 'object',
                  'members' => [
                    [
                      'name' => ['kind' => 'text', 'text' => 'pointer'],
                      'value' => ['kind' => 'slot', 'slot' => 'pointer', 'path' => []],
                    ],
                  ],
                ],
              ],
            ],
            'derivedFrom' => [
              'derivation' => 'requirement.errors',
              'from' => [
                ['layer' => 'shared', 'pointer' => '/schemas/Task/properties/effort/restrictedTo'],
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/update/requires/0',
                ],
              ],
            ],
          ],
          [
            'code' => 'api.not_found',
            'roles' => [['role' => 'notFound']],
            'derivedFrom' => [
              'derivation' => 'member.notFound',
              'from' => [
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/update',
                ],
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/update/requires/0',
                ],
                ['layer' => 'api', 'pointer' => '/surfaces/app/routes/channels/member/scopes/channel'],
              ],
            ],
          ],
          [
            'code' => 'api.idempotency_in_progress',
            'roles' => [['role' => 'idempotencyInProgress']],
            'derivedFrom' => [
              'derivation' => 'idempotency.write',
              'from' => [['layer' => 'shared', 'pointer' => '/conventions/idempotency']],
            ],
          ],
          [
            'code' => 'state.conflict',
            'roles' => [['role' => 'stateConflict']],
            'derivedFrom' => [
              'derivation' => 'concurrency.version',
              'from' => [
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/concurrency',
                ],
              ],
            ],
          ],
          [
            'code' => 'api.payload_too_large',
            'roles' => [
              [
                'role' => 'payloadTooLarge',
                'params' => [
                  'kind' => 'object',
                  'members' => [
                    [
                      'name' => ['kind' => 'text', 'text' => 'limitBytes'],
                      'value' => ['kind' => 'slot', 'slot' => 'limitBytes', 'path' => []],
                    ],
                  ],
                ],
              ],
            ],
            'derivedFrom' => [
              'derivation' => 'body.limit',
              'from' => [
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/update/input',
                ],
              ],
            ],
          ],
          [
            'code' => 'api.unsupported_media_type',
            'roles' => [['role' => 'unsupportedMediaType']],
            'derivedFrom' => [
              'derivation' => 'body.media',
              'from' => [
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/update/input',
                ],
              ],
            ],
          ],
          [
            'code' => 'api.idempotency_key_reused',
            'roles' => [['role' => 'idempotencyKeyReused']],
            'derivedFrom' => [
              'derivation' => 'idempotency.write',
              'from' => [['layer' => 'shared', 'pointer' => '/conventions/idempotency']],
            ],
          ],
          [
            'code' => 'api.internal',
            'roles' => [['role' => 'undeclaredStatus']],
            'derivedFrom' => [
              'derivation' => 'response.undeclared',
              'from' => [
                ['layer' => 'shared', 'pointer' => '/conventions/errors/every/0'],
                [
                  'layer' => 'api',
                  'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/update',
                ],
              ],
            ],
          ],
        ],
        'fieldRights' => [
          [
            'schema' => 'Task',
            'pointer' => '/effort',
            'right' => 'tasks.seeEffort',
            'subject' => ['source' => ['in' => 'holderField', 'name' => 'taskId']],
            'direction' => 'output',
            'derivedFrom' => [
              'derivation' => 'fieldRight.restricted',
              'from' => [['layer' => 'shared', 'pointer' => '/schemas/Task/properties/effort/restrictedTo']],
            ],
          ],
          [
            'schema' => 'UpdateTask',
            'pointer' => '/effort',
            'right' => 'tasks.seeEffort',
            'subject' => ['source' => ['in' => 'path', 'name' => 'taskId']],
            'direction' => 'input',
            'inputPolicy' => 'reject',
            'derivedFrom' => [
              'derivation' => 'fieldRight.restricted',
              'from' => [['layer' => 'shared', 'pointer' => '/schemas/Task/properties/effort/restrictedTo']],
            ],
          ],
        ],
        'idempotency' => [
          'kind' => 'derived',
          'header' => 'Idempotency-Key',
          'replayHeader' => 'Idempotency-Replayed',
          'lifetimeMs' => 86400000,
          'required' => true,
          'enforce' => 'boundary',
          'derivedFrom' => [
            'derivation' => 'idempotency.write',
            'from' => [['layer' => 'shared', 'pointer' => '/conventions/idempotency']],
          ],
        ],
        'concurrency' => [
          'version' => ['in' => 'body', 'name' => 'expectedVersion'],
          'field' => 'version',
          'derivedFrom' => [
            'derivation' => 'concurrency.version',
            'from' => [
              [
                'layer' => 'api',
                'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/concurrency',
              ],
            ],
          ],
        ],
        'upstream' => [],
        'maturity' => [
          'level' => 'provisional',
          'source' => 'api',
          'origin' => ['layer' => 'api', 'pointer' => '/api/maturity'],
        ],
        'internal' => false,
        'csrf' => [
          'kind' => 'derived',
          'header' => 'X-Csrf-Token',
          'derivedFrom' => [
            'derivation' => 'csrf.cookieWrite',
            'from' => [
              ['layer' => 'shared', 'pointer' => '/identities/user'],
              ['layer' => 'shared', 'pointer' => '/schemes/sessionCookie'],
            ],
          ],
        ],
        'format' => 'bare',
        'tags' => [],
        'examples' => [],
        'docs' => [],
        'extensions' => [],
        'origin' => ['layer' => 'api', 'pointer' => '/surfaces/app/routes/channels/member/routes/tasks/ops/update'],
      ],
    ],
  ];

  /** The PHP class of each schema, enum, operation part, result and identity. */
  public const TYPES = [
    'schemas' => [
      'ApiEmptyBody' => ['class' => 'Seampact\Golden\TasksConsistent\Schemas\ApiEmptyBody', 'members' => []],
      'ApiForbiddenParams' => [
        'class' => 'Seampact\Golden\TasksConsistent\Schemas\ApiForbiddenParams',
        'members' => ['pointer' => 'pointer'],
      ],
      'ApiPayloadTooLargeParams' => [
        'class' => 'Seampact\Golden\TasksConsistent\Schemas\ApiPayloadTooLargeParams',
        'members' => ['limitBytes' => 'limitBytes'],
      ],
      'ApiRateLimitedParams' => [
        'class' => 'Seampact\Golden\TasksConsistent\Schemas\ApiRateLimitedParams',
        'members' => ['retryAfterMs' => 'retryAfterMs'],
      ],
      'ApiSchemaInvalidParams' => [
        'class' => 'Seampact\Golden\TasksConsistent\Schemas\ApiSchemaInvalidParams',
        'members' => ['issues' => 'issues'],
      ],
      'Channel' => [
        'class' => 'Seampact\Golden\TasksConsistent\Schemas\Channel',
        'members' => ['channelId' => 'channelId', 'name' => 'name'],
      ],
      'CreateTask' => [
        'class' => 'Seampact\Golden\TasksConsistent\Schemas\CreateTask',
        'members' => ['title' => 'title', 'effort' => 'effort'],
      ],
      'Draft' => [
        'class' => 'Seampact\Golden\TasksConsistent\Schemas\Draft',
        'members' => ['draftId' => 'draftId', 'body' => 'body'],
      ],
      'GetTasksBatchInput' => [
        'class' => 'Seampact\Golden\TasksConsistent\Schemas\GetTasksBatchInput',
        'members' => ['ids' => 'ids'],
      ],
      'Health' => ['class' => 'Seampact\Golden\TasksConsistent\Schemas\Health', 'members' => ['status' => 'status']],
      'IssuesItem' => [
        'class' => 'Seampact\Golden\TasksConsistent\Schemas\IssuesItem',
        'members' => ['pointer' => 'pointer', 'rule' => 'rule'],
      ],
      'PaymentEvent' => [
        'class' => 'Seampact\Golden\TasksConsistent\Schemas\PaymentEvent',
        'members' => ['id' => 'id', 'type' => 'type', 'data' => 'data'],
      ],
      'Preferences' => [
        'class' => 'Seampact\Golden\TasksConsistent\Schemas\Preferences',
        'members' => ['locale' => 'locale', 'digest' => 'digest'],
      ],
      'Task' => [
        'class' => 'Seampact\Golden\TasksConsistent\Schemas\Task',
        'members' => [
          'taskId' => 'taskId',
          'title' => 'title',
          'state' => 'state',
          'effort' => 'effort',
          'version' => 'version',
          'createdAt' => 'createdAt',
        ],
      ],
      'TaskQuery' => [
        'class' => 'Seampact\Golden\TasksConsistent\Schemas\TaskQuery',
        'members' => ['text' => 'text', 'states' => 'states'],
      ],
      'TaskSearchResult' => [
        'class' => 'Seampact\Golden\TasksConsistent\Schemas\TaskSearchResult',
        'members' => ['items' => 'items', 'total' => 'total'],
      ],
      'UpdateTask' => [
        'class' => 'Seampact\Golden\TasksConsistent\Schemas\UpdateTask',
        'members' => [
          'title' => 'title',
          'state' => 'state',
          'effort' => 'effort',
          'expectedVersion' => 'expectedVersion',
        ],
      ],
    ],
    'enums' => ['TaskState' => 'Seampact\Golden\TasksConsistent\Schemas\TaskState'],
    'operations' => [
      'createTask' => [
        'input' => 'Seampact\Golden\TasksConsistent\CreateTaskInput',
        'parts' => [
          'path' => [
            'class' => 'Seampact\Golden\TasksConsistent\CreateTaskPath',
            'members' => ['channelId' => 'channelId'],
          ],
          'headers' => [
            'class' => 'Seampact\Golden\TasksConsistent\CreateTaskHeaders',
            'members' => ['Idempotency-Key' => 'idempotencyKey'],
          ],
        ],
        'responses' => [201 => 'Seampact\Golden\TasksConsistent\CreateTaskResponse201'],
        'errors' => 'Seampact\Golden\TasksConsistent\CreateTaskErrors',
      ],
      'getChannel' => [
        'input' => 'Seampact\Golden\TasksConsistent\GetChannelInput',
        'parts' => [
          'path' => [
            'class' => 'Seampact\Golden\TasksConsistent\GetChannelPath',
            'members' => ['channelId' => 'channelId'],
          ],
        ],
        'responses' => [200 => 'Seampact\Golden\TasksConsistent\GetChannelResponse200'],
        'errors' => 'Seampact\Golden\TasksConsistent\GetChannelErrors',
      ],
      'getDraft' => [
        'input' => 'Seampact\Golden\TasksConsistent\GetDraftInput',
        'parts' => [
          'path' => [
            'class' => 'Seampact\Golden\TasksConsistent\GetDraftPath',
            'members' => ['draftId' => 'draftId'],
          ],
        ],
        'responses' => [200 => 'Seampact\Golden\TasksConsistent\GetDraftResponse200'],
        'errors' => 'Seampact\Golden\TasksConsistent\GetDraftErrors',
      ],
      'getPreferences' => [
        'input' => 'Seampact\Golden\TasksConsistent\GetPreferencesInput',
        'parts' => [
          'headers' => [
            'class' => 'Seampact\Golden\TasksConsistent\GetPreferencesHeaders',
            'members' => ['If-None-Match' => 'ifNoneMatch'],
          ],
        ],
        'responses' => [
          200 => 'Seampact\Golden\TasksConsistent\GetPreferencesResponse200',
          304 => 'Seampact\Golden\TasksConsistent\GetPreferencesResponse304',
        ],
        'errors' => 'Seampact\Golden\TasksConsistent\GetPreferencesErrors',
      ],
      'getTask' => [
        'input' => 'Seampact\Golden\TasksConsistent\GetTaskInput',
        'parts' => [
          'path' => [
            'class' => 'Seampact\Golden\TasksConsistent\GetTaskPath',
            'members' => ['channelId' => 'channelId', 'taskId' => 'taskId'],
          ],
        ],
        'responses' => [200 => 'Seampact\Golden\TasksConsistent\GetTaskResponse200'],
        'errors' => 'Seampact\Golden\TasksConsistent\GetTaskErrors',
      ],
      'getTasksBatch' => [
        'input' => 'Seampact\Golden\TasksConsistent\GetTasksBatchInput',
        'parts' => [
          'path' => [
            'class' => 'Seampact\Golden\TasksConsistent\GetTasksBatchPath',
            'members' => ['channelId' => 'channelId'],
          ],
        ],
        'responses' => [200 => 'Seampact\Golden\TasksConsistent\GetTasksBatchResponse200'],
        'errors' => 'Seampact\Golden\TasksConsistent\GetTasksBatchErrors',
      ],
      'health' => [
        'input' => 'Seampact\Golden\TasksConsistent\HealthInput',
        'parts' => [],
        'responses' => [200 => 'Seampact\Golden\TasksConsistent\HealthResponse200'],
        'errors' => 'Seampact\Golden\TasksConsistent\HealthErrors',
      ],
      'listTasks' => [
        'input' => 'Seampact\Golden\TasksConsistent\ListTasksInput',
        'parts' => [
          'path' => [
            'class' => 'Seampact\Golden\TasksConsistent\ListTasksPath',
            'members' => ['channelId' => 'channelId'],
          ],
          'query' => [
            'class' => 'Seampact\Golden\TasksConsistent\ListTasksQuery',
            'members' => ['cursor' => 'cursor', 'limit' => 'limit', 'sort' => 'sort'],
          ],
        ],
        'responses' => [200 => 'Seampact\Golden\TasksConsistent\ListTasksResponse200'],
        'errors' => 'Seampact\Golden\TasksConsistent\ListTasksErrors',
      ],
      'payments' => [
        'input' => 'Seampact\Golden\TasksConsistent\PaymentsInput',
        'parts' => [],
        'responses' => [204 => 'Seampact\Golden\TasksConsistent\PaymentsResponse204'],
        'errors' => 'Seampact\Golden\TasksConsistent\PaymentsErrors',
      ],
      'purgeTask' => [
        'input' => 'Seampact\Golden\TasksConsistent\PurgeTaskInput',
        'parts' => [
          'path' => [
            'class' => 'Seampact\Golden\TasksConsistent\PurgeTaskPath',
            'members' => ['channelId' => 'channelId', 'taskId' => 'taskId'],
          ],
          'headers' => [
            'class' => 'Seampact\Golden\TasksConsistent\PurgeTaskHeaders',
            'members' => ['Idempotency-Key' => 'idempotencyKey'],
          ],
        ],
        'responses' => [204 => 'Seampact\Golden\TasksConsistent\PurgeTaskResponse204'],
        'errors' => 'Seampact\Golden\TasksConsistent\PurgeTaskErrors',
      ],
      'searchTasks' => [
        'input' => 'Seampact\Golden\TasksConsistent\SearchTasksInput',
        'parts' => [
          'path' => [
            'class' => 'Seampact\Golden\TasksConsistent\SearchTasksPath',
            'members' => ['channelId' => 'channelId'],
          ],
        ],
        'responses' => [200 => 'Seampact\Golden\TasksConsistent\SearchTasksResponse200'],
        'errors' => 'Seampact\Golden\TasksConsistent\SearchTasksErrors',
      ],
      'updateTask' => [
        'input' => 'Seampact\Golden\TasksConsistent\UpdateTaskInput',
        'parts' => [
          'path' => [
            'class' => 'Seampact\Golden\TasksConsistent\UpdateTaskPath',
            'members' => ['channelId' => 'channelId', 'taskId' => 'taskId'],
          ],
          'headers' => [
            'class' => 'Seampact\Golden\TasksConsistent\UpdateTaskHeaders',
            'members' => ['Idempotency-Key' => 'idempotencyKey'],
          ],
        ],
        'responses' => [200 => 'Seampact\Golden\TasksConsistent\UpdateTaskResponse200'],
        'errors' => 'Seampact\Golden\TasksConsistent\UpdateTaskErrors',
      ],
    ],
    'identities' => [
      'stripe' => [
        'hook' => 'Seampact\Golden\TasksConsistent\Symfony\StripeAuthenticateHook',
        'credentials' => 'Seampact\Golden\TasksConsistent\Symfony\StripeCredentials',
        'principal' => 'Seampact\Golden\TasksConsistent\Symfony\StripePrincipal',
        'principalMembers' => 'Seampact\Golden\TasksConsistent\Symfony\StripePrincipalMembers',
        'schemes' => ['stripeSignature' => 'stripeSignature'],
        'principalAccessors' => ['account' => 'account'],
      ],
      'user' => [
        'hook' => 'Seampact\Golden\TasksConsistent\Symfony\UserAuthenticateHook',
        'credentials' => 'Seampact\Golden\TasksConsistent\Symfony\UserCredentials',
        'principal' => 'Seampact\Golden\TasksConsistent\Symfony\UserPrincipal',
        'principalMembers' => 'Seampact\Golden\TasksConsistent\Symfony\UserPrincipalMembers',
        'schemes' => ['bearer' => 'bearer', 'sessionCookie' => 'sessionCookie'],
        'principalAccessors' => ['userId' => 'userId'],
      ],
    ],
  ];

  /** The app routes the entry's `frameworkRoutes` lets through the boot check. */
  public const FRAMEWORK_ROUTES = [];
}
