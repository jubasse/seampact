"""The contract of api 'tasksService' as its boundary reads it."""

import typing as _typing

import seampact.codegen.runtime.contract as _contract

CONTRACT: _typing.Final = _contract.ApiContract(
    api="tasksService",
    generated_by="0.0.0-dev",
    mount="",
    ir_view={
        "api": {
            "id": "tasksService",
            "name": {
                "segments": [
                    "tasks",
                    "service",
                ],
                "role": "schema",
            },
            "version": {
                "kind": "path",
                "number": 1,
            },
            "kind": "service",
            "pathVersion": {
                "value": "prefix",
                "origin": {
                    "layer": "api",
                    "pointer": "/api/version",
                },
            },
            "maturity": "provisional",
            "caller": {
                "identity": "service",
                "right": "callerService",
            },
            "compat": {
                "policy": "none",
            },
            "wire": {
                "int64": "string",
                "outputEnums": "enum",
                "urls": "relative",
            },
            "surfaces": {
                "internal": {
                    "name": {
                        "segments": [
                            "internal",
                        ],
                        "role": "schema",
                    },
                    "prefix": "/internal/v1",
                    "pathVersion": "prefix",
                    "origin": {
                        "layer": "api",
                        "pointer": "/surfaces/internal",
                    },
                },
            },
            "documents": {},
            "docs": {},
            "extensions": {},
            "origin": {
                "layer": "api",
                "pointer": "/api",
            },
        },
        "errors": {
            "api.deadline_exceeded": {
                "code": "api.deadline_exceeded",
                "family": "api",
                "nature": "unavailable",
                "http": {
                    "status": 504,
                },
                "docs": {},
                "origin": {
                    "layer": "core",
                    "pointer": "/errors/api.deadline_exceeded",
                },
                "default": "deadlineExceeded",
            },
            "api.forbidden": {
                "code": "api.forbidden",
                "family": "api",
                "nature": "refused",
                "http": {
                    "status": 403,
                },
                "params": "ApiForbiddenParams",
                "docs": {},
                "origin": {
                    "layer": "core",
                    "pointer": "/errors/api.forbidden",
                },
                "default": "forbidden",
            },
            "api.internal": {
                "code": "api.internal",
                "family": "api",
                "nature": "failed",
                "http": {
                    "status": 500,
                },
                "docs": {},
                "origin": {
                    "layer": "core",
                    "pointer": "/errors/api.internal",
                },
                "default": "undeclaredStatus",
            },
            "api.not_found": {
                "code": "api.not_found",
                "family": "api",
                "nature": "refused",
                "http": {
                    "status": 404,
                },
                "docs": {},
                "origin": {
                    "layer": "core",
                    "pointer": "/errors/api.not_found",
                },
                "default": "notFound",
            },
            "api.schema_invalid": {
                "code": "api.schema_invalid",
                "family": "api",
                "nature": "refused",
                "http": {
                    "status": 400,
                },
                "params": "ApiSchemaInvalidParams",
                "example": {
                    "issues": [
                        {
                            "pointer": "/title",
                            "rule": "minLength",
                        },
                    ],
                },
                "docs": {},
                "origin": {
                    "layer": "shared",
                    "pointer": "/errors/api.schema_invalid",
                },
                "default": "schemaInvalid",
            },
            "api.unauthenticated": {
                "code": "api.unauthenticated",
                "family": "api",
                "nature": "refused",
                "http": {
                    "status": 401,
                },
                "docs": {},
                "origin": {
                    "layer": "core",
                    "pointer": "/errors/api.unauthenticated",
                },
                "default": "unauthenticated",
            },
        },
        "formats": {
            "bare": {
                "id": "bare",
                "origin": {
                    "layer": "core",
                    "pointer": "/formats/bare",
                },
                "media": "application/json",
                "absent": "omit",
                "success": {
                    "item": {
                        "body": {
                            "kind": "slot",
                            "slot": "payload",
                            "path": [],
                        },
                        "headers": [],
                    },
                    "table": {
                        "body": {
                            "kind": "slot",
                            "slot": "payload",
                            "path": [],
                        },
                        "headers": [],
                    },
                    "list": {
                        "body": {
                            "kind": "slot",
                            "slot": "payload",
                            "path": [],
                        },
                        "headers": [],
                    },
                    "page": {
                        "body": {
                            "kind": "slot",
                            "slot": "items",
                            "path": [],
                        },
                        "headers": [],
                    },
                },
                "meta": {},
                "error": {
                    "media": "application/problem+json",
                    "body": {
                        "kind": "object",
                        "members": [
                            {
                                "name": {
                                    "kind": "text",
                                    "text": "type",
                                },
                                "value": {
                                    "kind": "slot",
                                    "slot": "code",
                                    "path": [],
                                },
                            },
                            {
                                "name": {
                                    "kind": "text",
                                    "text": "title",
                                },
                                "value": {
                                    "kind": "slot",
                                    "slot": "title",
                                    "path": [],
                                },
                            },
                            {
                                "name": {
                                    "kind": "text",
                                    "text": "status",
                                },
                                "value": {
                                    "kind": "slot",
                                    "slot": "status",
                                    "path": [],
                                },
                            },
                            {
                                "name": {
                                    "kind": "text",
                                    "text": "detail",
                                },
                                "value": {
                                    "kind": "slot",
                                    "slot": "detail",
                                    "path": [],
                                },
                            },
                            {
                                "name": {
                                    "kind": "text",
                                    "text": "instance",
                                },
                                "value": {
                                    "kind": "slot",
                                    "slot": "instance",
                                    "path": [],
                                },
                            },
                            {
                                "name": {
                                    "kind": "text",
                                    "text": "code",
                                },
                                "value": {
                                    "kind": "slot",
                                    "slot": "code",
                                    "path": [],
                                },
                            },
                            {
                                "name": {
                                    "kind": "text",
                                    "text": "nature",
                                },
                                "value": {
                                    "kind": "slot",
                                    "slot": "nature",
                                    "path": [],
                                },
                            },
                            {
                                "name": {
                                    "kind": "text",
                                    "text": "traceId",
                                },
                                "value": {
                                    "kind": "slot",
                                    "slot": "traceId",
                                    "path": [],
                                },
                            },
                        ],
                        "merge": "params",
                    },
                    "headers": [],
                },
            },
        },
        "identities": {
            "service": {
                "id": "service",
                "kind": "credential",
                "schemes": {
                    "read": [
                        "internalToken",
                    ],
                    "write": [
                        "internalToken",
                    ],
                    "optionalRead": [],
                },
                "principal": {
                    "kind": "schema",
                    "schema": "ServicePrincipal",
                },
                "errors": [],
                "headers": [
                    {
                        "header": "actorSurface",
                        "for": "writes",
                        "required": True,
                        "schema": {
                            "kind": "enum",
                            "enum": "Surface",
                        },
                        "origin": {
                            "layer": "shared",
                            "pointer": "/identities/service/headers/actorSurface",
                        },
                    },
                    {
                        "header": "deadline",
                        "for": "all",
                        "required": True,
                        "origin": {
                            "layer": "shared",
                            "pointer": "/identities/service/headers/deadline",
                        },
                    },
                    {
                        "header": "trace",
                        "for": "all",
                        "required": False,
                        "origin": {
                            "layer": "shared",
                            "pointer": "/identities/service/headers/trace",
                        },
                    },
                ],
                "docs": {},
                "extensions": {},
                "origin": {
                    "layer": "shared",
                    "pointer": "/identities/service",
                },
            },
            "stripe": {
                "id": "stripe",
                "kind": "signed",
                "signed": "stripeSignature",
                "principal": {
                    "kind": "schema",
                    "schema": "WebhookCaller",
                },
                "errors": [],
                "headers": [],
                "docs": {},
                "extensions": {},
                "origin": {
                    "layer": "shared",
                    "pointer": "/identities/stripe",
                },
            },
            "user": {
                "id": "user",
                "kind": "credential",
                "schemes": {
                    "read": [
                        "bearer",
                        "sessionCookie",
                    ],
                    "write": [
                        "bearer",
                        "sessionCookie",
                    ],
                    "optionalRead": [],
                },
                "principal": {
                    "kind": "schema",
                    "schema": "UserPrincipal",
                },
                "errors": [],
                "headers": [],
                "docs": {},
                "extensions": {},
                "origin": {
                    "layer": "shared",
                    "pointer": "/identities/user",
                },
            },
        },
        "schemes": {
            "bearer": {
                "id": "bearer",
                "kind": "bearer",
                "origin": {
                    "layer": "shared",
                    "pointer": "/schemes/bearer",
                },
            },
            "csrfToken": {
                "id": "csrfToken",
                "kind": "header",
                "name": "X-Csrf-Token",
                "origin": {
                    "layer": "shared",
                    "pointer": "/schemes/csrfToken",
                },
            },
            "internalToken": {
                "id": "internalToken",
                "kind": "bearer",
                "bearer": {
                    "format": "jwt",
                },
                "origin": {
                    "layer": "shared",
                    "pointer": "/schemes/internalToken",
                },
            },
            "sessionCookie": {
                "id": "sessionCookie",
                "kind": "cookie",
                "name": "__Host-session",
                "csrf": "csrfToken",
                "origin": {
                    "layer": "shared",
                    "pointer": "/schemes/sessionCookie",
                },
            },
            "stripeSignature": {
                "id": "stripeSignature",
                "kind": "signature",
                "name": "Stripe-Signature",
                "signature": {
                    "verify": "template",
                    "format": "t={ts},v1={sig}",
                    "algorithm": "hmac-sha256",
                    "payload": "{ts}.{rawBody}",
                    "encoding": "hex",
                    "toleranceMs": 300000,
                    "key": {
                        "kind": "value",
                        "value": "stripe",
                    },
                },
                "origin": {
                    "layer": "shared",
                    "pointer": "/schemes/stripeSignature",
                },
            },
        },
        "scopes": {},
        "rights": {
            "callerService": {
                "id": "callerService",
                "params": "CallerServiceParams",
                "subject": {
                    "kind": "none",
                },
                "errors": [
                    "api.forbidden",
                ],
                "docs": {},
                "extensions": {},
                "origin": {
                    "layer": "shared",
                    "pointer": "/rights/callerService",
                },
            },
            "tasks.seeEffort": {
                "id": "tasks.seeEffort",
                "subject": {
                    "kind": "resource",
                    "type": {
                        "segments": [
                            "task",
                        ],
                        "role": "schema",
                    },
                    "idSchema": {
                        "kind": "scalar",
                        "type": "string",
                        "format": "uuid",
                        "refinements": {},
                    },
                },
                "errors": [
                    "api.forbidden",
                ],
                "docs": {},
                "extensions": {},
                "origin": {
                    "layer": "shared",
                    "pointer": "/rights/tasks.seeEffort",
                },
            },
        },
        "rules": {},
        "buckets": {},
        "pagings": {},
        "schemas": {
            "ApiForbiddenParams": {
                "kind": "object",
                "properties": [
                    {
                        "name": "pointer",
                        "type": {
                            "kind": "scalar",
                            "type": "string",
                            "refinements": {},
                        },
                        "optional": True,
                        "nullable": False,
                        "sensitive": False,
                        "deprecated": False,
                        "docs": {},
                        "extensions": {},
                        "origin": {
                            "layer": "core",
                            "pointer": "/errors/api.forbidden/params/pointer",
                        },
                    },
                ],
                "id": "ApiForbiddenParams",
                "name": {
                    "segments": [
                        "api",
                        "forbidden",
                    ],
                    "role": "params",
                },
                "directions": [
                    "output",
                ],
                "examples": [],
                "docs": {},
                "extensions": {},
                "origin": {
                    "layer": "core",
                    "pointer": "/errors/api.forbidden/params",
                },
            },
            "ApiSchemaInvalidParams": {
                "kind": "object",
                "properties": [
                    {
                        "name": "issues",
                        "type": {
                            "kind": "array",
                            "items": {
                                "kind": "ref",
                                "schema": "IssuesItem",
                            },
                        },
                        "optional": False,
                        "nullable": False,
                        "sensitive": False,
                        "deprecated": False,
                        "docs": {},
                        "extensions": {},
                        "origin": {
                            "layer": "shared",
                            "pointer": "/errors/api.schema_invalid/params/issues",
                        },
                    },
                ],
                "id": "ApiSchemaInvalidParams",
                "name": {
                    "segments": [
                        "api",
                        "schema",
                        "invalid",
                    ],
                    "role": "params",
                },
                "directions": [
                    "output",
                ],
                "examples": [],
                "docs": {},
                "extensions": {},
                "origin": {
                    "layer": "shared",
                    "pointer": "/errors/api.schema_invalid/params",
                },
            },
            "CallerServiceParams": {
                "kind": "object",
                "properties": [
                    {
                        "name": "allowed",
                        "type": {
                            "kind": "array",
                            "items": {
                                "kind": "enum",
                                "enum": "Service",
                            },
                            "minItems": 1,
                        },
                        "optional": False,
                        "nullable": False,
                        "sensitive": False,
                        "deprecated": False,
                        "docs": {},
                        "extensions": {},
                        "origin": {
                            "layer": "shared",
                            "pointer": "/rights/callerService/params/allowed",
                        },
                    },
                ],
                "id": "CallerServiceParams",
                "name": {
                    "segments": [
                        "caller",
                        "service",
                    ],
                    "role": "params",
                },
                "directions": [
                    "input",
                ],
                "examples": [],
                "docs": {},
                "extensions": {},
                "origin": {
                    "layer": "shared",
                    "pointer": "/rights/callerService/params",
                },
            },
            "IssuesItem": {
                "kind": "object",
                "properties": [
                    {
                        "name": "pointer",
                        "type": {
                            "kind": "scalar",
                            "type": "string",
                            "refinements": {},
                        },
                        "optional": False,
                        "nullable": False,
                        "sensitive": False,
                        "deprecated": False,
                        "docs": {},
                        "extensions": {},
                        "origin": {
                            "layer": "shared",
                            "pointer": "/schemas/Issues/items/properties/pointer",
                        },
                    },
                    {
                        "name": "rule",
                        "type": {
                            "kind": "scalar",
                            "type": "string",
                            "refinements": {},
                        },
                        "optional": False,
                        "nullable": False,
                        "sensitive": False,
                        "deprecated": False,
                        "docs": {},
                        "extensions": {},
                        "origin": {
                            "layer": "shared",
                            "pointer": "/schemas/Issues/items/properties/rule",
                        },
                    },
                ],
                "id": "IssuesItem",
                "name": {
                    "segments": [
                        "issues",
                    ],
                    "role": "item",
                },
                "directions": [
                    "output",
                ],
                "examples": [],
                "docs": {},
                "extensions": {},
                "origin": {
                    "layer": "shared",
                    "pointer": "/schemas/Issues/items",
                },
            },
            "ServicePrincipal": {
                "kind": "object",
                "properties": [
                    {
                        "name": "service",
                        "type": {
                            "kind": "enum",
                            "enum": "Service",
                        },
                        "optional": False,
                        "nullable": False,
                        "sensitive": False,
                        "deprecated": False,
                        "docs": {},
                        "extensions": {},
                        "origin": {
                            "layer": "shared",
                            "pointer": "/schemas/ServicePrincipal/properties/service",
                        },
                    },
                    {
                        "name": "userId",
                        "type": {
                            "kind": "scalar",
                            "type": "string",
                            "format": "uuid",
                            "refinements": {},
                        },
                        "optional": False,
                        "nullable": False,
                        "sensitive": False,
                        "deprecated": False,
                        "docs": {},
                        "extensions": {},
                        "origin": {
                            "layer": "shared",
                            "pointer": "/schemas/ServicePrincipal/properties/userId",
                        },
                    },
                ],
                "id": "ServicePrincipal",
                "name": {
                    "segments": [
                        "service",
                        "principal",
                    ],
                    "role": "schema",
                },
                "directions": [
                    "output",
                ],
                "examples": [],
                "docs": {},
                "extensions": {},
                "origin": {
                    "layer": "shared",
                    "pointer": "/schemas/ServicePrincipal",
                },
            },
            "Task": {
                "kind": "object",
                "properties": [
                    {
                        "name": "taskId",
                        "type": {
                            "kind": "scalar",
                            "type": "string",
                            "format": "uuid",
                            "refinements": {},
                        },
                        "optional": False,
                        "nullable": False,
                        "sensitive": False,
                        "deprecated": False,
                        "docs": {},
                        "extensions": {},
                        "origin": {
                            "layer": "shared",
                            "pointer": "/schemas/Task/properties/taskId",
                        },
                    },
                    {
                        "name": "title",
                        "type": {
                            "kind": "scalar",
                            "type": "string",
                            "refinements": {
                                "minLength": 1,
                                "maxLength": 200,
                            },
                        },
                        "optional": False,
                        "nullable": False,
                        "sensitive": False,
                        "deprecated": False,
                        "docs": {},
                        "extensions": {},
                        "origin": {
                            "layer": "shared",
                            "pointer": "/schemas/Task/properties/title",
                        },
                    },
                    {
                        "name": "state",
                        "type": {
                            "kind": "enum",
                            "enum": "TaskState",
                        },
                        "optional": False,
                        "nullable": False,
                        "sensitive": False,
                        "deprecated": False,
                        "docs": {},
                        "extensions": {},
                        "origin": {
                            "layer": "shared",
                            "pointer": "/schemas/Task/properties/state",
                        },
                    },
                    {
                        "name": "effort",
                        "type": {
                            "kind": "scalar",
                            "type": "integer",
                            "refinements": {
                                "minimum": "0",
                            },
                        },
                        "optional": True,
                        "nullable": False,
                        "sensitive": False,
                        "restrictedTo": {
                            "right": "tasks.seeEffort",
                            "origin": {
                                "layer": "shared",
                                "pointer": "/schemas/Task/properties/effort/restrictedTo",
                            },
                        },
                        "deprecated": False,
                        "docs": {},
                        "extensions": {},
                        "origin": {
                            "layer": "shared",
                            "pointer": "/schemas/Task/properties/effort",
                        },
                    },
                    {
                        "name": "version",
                        "type": {
                            "kind": "scalar",
                            "type": "integer",
                            "refinements": {
                                "minimum": "1",
                            },
                        },
                        "optional": False,
                        "nullable": False,
                        "sensitive": False,
                        "deprecated": False,
                        "docs": {},
                        "extensions": {},
                        "origin": {
                            "layer": "shared",
                            "pointer": "/schemas/Task/properties/version",
                        },
                    },
                    {
                        "name": "createdAt",
                        "type": {
                            "kind": "scalar",
                            "type": "string",
                            "format": "date-time",
                            "refinements": {},
                        },
                        "optional": False,
                        "nullable": False,
                        "sensitive": False,
                        "deprecated": False,
                        "docs": {},
                        "extensions": {},
                        "origin": {
                            "layer": "shared",
                            "pointer": "/schemas/Task/properties/createdAt",
                        },
                    },
                ],
                "id": "Task",
                "name": {
                    "segments": [
                        "task",
                    ],
                    "role": "schema",
                },
                "directions": [
                    "output",
                ],
                "examples": [],
                "docs": {},
                "extensions": {},
                "origin": {
                    "layer": "shared",
                    "pointer": "/schemas/Task",
                },
            },
            "UserPrincipal": {
                "kind": "object",
                "properties": [
                    {
                        "name": "userId",
                        "type": {
                            "kind": "scalar",
                            "type": "string",
                            "format": "uuid",
                            "refinements": {},
                        },
                        "optional": False,
                        "nullable": False,
                        "sensitive": False,
                        "deprecated": False,
                        "docs": {},
                        "extensions": {},
                        "origin": {
                            "layer": "shared",
                            "pointer": "/schemas/UserPrincipal/properties/userId",
                        },
                    },
                ],
                "id": "UserPrincipal",
                "name": {
                    "segments": [
                        "user",
                        "principal",
                    ],
                    "role": "schema",
                },
                "directions": [
                    "output",
                ],
                "examples": [],
                "docs": {},
                "extensions": {},
                "origin": {
                    "layer": "shared",
                    "pointer": "/schemas/UserPrincipal",
                },
            },
            "WebhookCaller": {
                "kind": "object",
                "properties": [
                    {
                        "name": "account",
                        "type": {
                            "kind": "scalar",
                            "type": "string",
                            "refinements": {},
                        },
                        "optional": False,
                        "nullable": False,
                        "sensitive": False,
                        "deprecated": False,
                        "docs": {},
                        "extensions": {},
                        "origin": {
                            "layer": "shared",
                            "pointer": "/schemas/WebhookCaller/properties/account",
                        },
                    },
                ],
                "id": "WebhookCaller",
                "name": {
                    "segments": [
                        "webhook",
                        "caller",
                    ],
                    "role": "schema",
                },
                "directions": [
                    "output",
                ],
                "examples": [],
                "docs": {},
                "extensions": {},
                "origin": {
                    "layer": "shared",
                    "pointer": "/schemas/WebhookCaller",
                },
            },
        },
        "enums": {
            "Service": {
                "id": "Service",
                "name": {
                    "segments": [
                        "service",
                    ],
                    "role": "schema",
                },
                "values": [
                    "catalog",
                    "ticketing",
                ],
                "localReason": "The product's internal services.",
                "directions": [
                    "input",
                    "output",
                ],
                "docs": {},
                "origin": {
                    "layer": "shared",
                    "pointer": "/enums/Service",
                },
            },
            "Surface": {
                "id": "Surface",
                "name": {
                    "segments": [
                        "surface",
                    ],
                    "role": "schema",
                },
                "values": [
                    "app",
                    "studio",
                ],
                "localReason": "The product's entry points.",
                "directions": [
                    "input",
                ],
                "docs": {},
                "origin": {
                    "layer": "shared",
                    "pointer": "/enums/Surface",
                },
            },
            "TaskState": {
                "id": "TaskState",
                "name": {
                    "segments": [
                        "task",
                        "state",
                    ],
                    "role": "schema",
                },
                "values": [
                    "open",
                    "done",
                    "archived",
                ],
                "localReason": "Task states belong to this api.",
                "directions": [
                    "output",
                ],
                "docs": {},
                "origin": {
                    "layer": "shared",
                    "pointer": "/enums/TaskState",
                },
            },
        },
        "operations": [
            {
                "kind": "httpOperation",
                "id": "getTask",
                "name": {
                    "segments": [
                        "get",
                        "task",
                    ],
                    "role": "operation",
                },
                "surface": "internal",
                "features": [],
                "method": "get",
                "path": "/internal/v1/channels/{channelId}/tasks/{taskId}",
                "safe": True,
                "params": {
                    "path": [
                        {
                            "name": "channelId",
                            "type": {
                                "kind": "scalar",
                                "type": "string",
                                "format": "uuid",
                                "refinements": {},
                            },
                            "required": True,
                            "origin": {
                                "api": "tasks",
                                "layer": "api",
                                "pointer": "/surfaces/app/routes/channels/id/channelId",
                            },
                            "derivedFrom": {
                                "derivation": "relay.route",
                                "from": [
                                    {
                                        "api": "tasks",
                                        "layer": "api",
                                        "pointer": "/surfaces/app/routes/channels/member/routes/tasks/ops/get",
                                    },
                                ],
                            },
                        },
                        {
                            "name": "taskId",
                            "type": {
                                "kind": "scalar",
                                "type": "string",
                                "format": "uuid",
                                "refinements": {},
                            },
                            "required": True,
                            "origin": {
                                "api": "tasks",
                                "layer": "api",
                                "pointer": "/surfaces/app/routes/channels/member/routes/tasks/id/taskId",
                            },
                            "derivedFrom": {
                                "derivation": "relay.route",
                                "from": [
                                    {
                                        "api": "tasks",
                                        "layer": "api",
                                        "pointer": "/surfaces/app/routes/channels/member/routes/tasks/ops/get",
                                    },
                                ],
                            },
                        },
                    ],
                    "query": [],
                    "header": [
                        {
                            "name": "Authorization",
                            "type": {
                                "kind": "scalar",
                                "type": "string",
                                "refinements": {},
                            },
                            "required": True,
                            "derivedFrom": {
                                "derivation": "identity.authenticate",
                                "from": [
                                    {
                                        "layer": "api",
                                        "pointer": "/api/caller/identity",
                                    },
                                    {
                                        "layer": "shared",
                                        "pointer": "/schemes/internalToken",
                                    },
                                ],
                            },
                        },
                        {
                            "name": "X-Deadline",
                            "type": {
                                "kind": "scalar",
                                "type": "string",
                                "refinements": {},
                            },
                            "required": True,
                            "derivedFrom": {
                                "derivation": "identity.header",
                                "from": [
                                    {
                                        "layer": "shared",
                                        "pointer": "/identities/service/headers/deadline",
                                    },
                                    {
                                        "layer": "shared",
                                        "pointer": "/headers/deadline",
                                    },
                                ],
                            },
                        },
                        {
                            "name": "traceparent",
                            "type": {
                                "kind": "scalar",
                                "type": "string",
                                "refinements": {},
                            },
                            "required": False,
                            "derivedFrom": {
                                "derivation": "identity.header",
                                "from": [
                                    {
                                        "layer": "shared",
                                        "pointer": "/identities/service/headers/trace",
                                    },
                                    {
                                        "layer": "shared",
                                        "pointer": "/headers/trace",
                                    },
                                ],
                            },
                        },
                    ],
                },
                "unknownQuery": {
                    "policy": "refuse",
                },
                "access": {
                    "kind": "identity",
                    "identity": "service",
                    "schemes": [
                        "internalToken",
                    ],
                    "origin": {
                        "layer": "api",
                        "pointer": "/api/caller/identity",
                    },
                },
                "callerKinds": [
                    "identified",
                ],
                "principalRequires": [],
                "scopes": [],
                "requires": [
                    {
                        "kind": "right",
                        "right": "callerService",
                        "params": {
                            "allowed": [
                                "catalog",
                            ],
                        },
                        "origin": {
                            "layer": "api",
                            "pointer": "/surfaces/internal/requires/0",
                        },
                    },
                ],
                "bindings": [],
                "responses": [
                    {
                        "status": 200,
                        "media": "application/json",
                        "body": {
                            "kind": "ref",
                            "schema": "Task",
                        },
                        "shape": "item",
                        "headers": [],
                        "origin": {
                            "api": "tasks",
                            "layer": "api",
                            "pointer": "/surfaces/app/routes/channels/member/routes/tasks/item",
                        },
                        "derivedFrom": {
                            "derivation": "relay.route",
                            "from": [
                                {
                                    "api": "tasks",
                                    "layer": "api",
                                    "pointer": "/surfaces/app/routes/channels/member/routes/tasks/ops/get",
                                },
                            ],
                        },
                    },
                ],
                "errors": [
                    {
                        "code": "api.schema_invalid",
                        "roles": [
                            {
                                "role": "schemaInvalid",
                                "params": {
                                    "kind": "object",
                                    "members": [
                                        {
                                            "name": {
                                                "kind": "text",
                                                "text": "issues",
                                            },
                                            "value": {
                                                "kind": "each",
                                                "of": "issues",
                                                "as": {
                                                    "kind": "object",
                                                    "members": [
                                                        {
                                                            "name": {
                                                                "kind": "text",
                                                                "text": "pointer",
                                                            },
                                                            "value": {
                                                                "kind": "slot",
                                                                "slot": "item",
                                                                "path": [
                                                                    "pointer",
                                                                ],
                                                            },
                                                        },
                                                        {
                                                            "name": {
                                                                "kind": "text",
                                                                "text": "rule",
                                                            },
                                                            "value": {
                                                                "kind": "slot",
                                                                "slot": "item",
                                                                "path": [
                                                                    "rule",
                                                                ],
                                                            },
                                                        },
                                                    ],
                                                },
                                            },
                                        },
                                    ],
                                },
                            },
                        ],
                        "derivedFrom": {
                            "derivation": "input.invalid",
                            "from": [
                                {
                                    "layer": "api",
                                    "pointer": "/surfaces/internal/routes/getTask",
                                },
                                {
                                    "layer": "shared",
                                    "pointer": "/conventions/errors/derived/schemaInvalid",
                                },
                            ],
                        },
                    },
                    {
                        "code": "api.unauthenticated",
                        "roles": [
                            {
                                "role": "unauthenticated",
                            },
                        ],
                        "derivedFrom": {
                            "derivation": "identity.authenticate",
                            "from": [
                                {
                                    "layer": "api",
                                    "pointer": "/api/caller/identity",
                                },
                            ],
                        },
                    },
                    {
                        "code": "api.forbidden",
                        "derivedFrom": {
                            "derivation": "requirement.errors",
                            "from": [
                                {
                                    "layer": "api",
                                    "pointer": "/surfaces/internal/requires/0",
                                },
                            ],
                        },
                    },
                    {
                        "code": "api.not_found",
                        "roles": [
                            {
                                "role": "notFound",
                            },
                        ],
                        "derivedFrom": {
                            "derivation": "relay.route",
                            "from": [
                                {
                                    "api": "tasks",
                                    "layer": "api",
                                    "pointer": "/surfaces/app/routes/channels/member/routes/tasks/ops/get",
                                },
                            ],
                        },
                    },
                    {
                        "code": "api.internal",
                        "roles": [
                            {
                                "role": "undeclaredStatus",
                            },
                        ],
                        "derivedFrom": {
                            "derivation": "response.undeclared",
                            "from": [
                                {
                                    "layer": "shared",
                                    "pointer": "/conventions/errors/every/0",
                                },
                                {
                                    "layer": "api",
                                    "pointer": "/surfaces/internal/routes/getTask",
                                },
                            ],
                        },
                    },
                    {
                        "code": "api.deadline_exceeded",
                        "roles": [
                            {
                                "role": "deadlineExceeded",
                            },
                        ],
                        "derivedFrom": {
                            "derivation": "identity.deadline",
                            "from": [
                                {
                                    "layer": "shared",
                                    "pointer": "/headers/deadline",
                                },
                                {
                                    "layer": "shared",
                                    "pointer": "/identities/service/headers/deadline",
                                },
                                {
                                    "layer": "api",
                                    "pointer": "/api",
                                },
                            ],
                        },
                    },
                ],
                "fieldRights": [],
                "deadlineHeader": "X-Deadline",
                "relays": {
                    "kind": "httpOperation",
                    "api": "tasks",
                    "id": "getTask",
                },
                "upstream": [],
                "maturity": {
                    "level": "provisional",
                    "source": "api",
                    "origin": {
                        "layer": "api",
                        "pointer": "/api/maturity",
                    },
                },
                "internal": False,
                "format": "bare",
                "tags": [],
                "examples": {},
                "docs": {},
                "extensions": {},
                "origin": {
                    "layer": "api",
                    "pointer": "/surfaces/internal/routes/getTask",
                },
            },
        ],
    },
    members={
        "ApiForbiddenParams": {
            "pointer": "pointer",
        },
        "ApiSchemaInvalidParams": {
            "issues": "issues",
        },
        "CallerServiceParams": {
            "allowed": "allowed",
        },
        "IssuesItem": {
            "pointer": "pointer",
            "rule": "rule",
        },
        "ServicePrincipal": {
            "service": "service",
            "userId": "user_id",
        },
        "Task": {
            "taskId": "task_id",
            "title": "title",
            "state": "state",
            "effort": "effort",
            "version": "version",
            "createdAt": "created_at",
        },
        "UserPrincipal": {
            "userId": "user_id",
        },
        "WebhookCaller": {
            "account": "account",
        },
    },
    operation_members={
        "getTask": {
            "path": {
                "channelId": "channel_id",
                "taskId": "task_id",
            },
            "header": {
                "X-Deadline": "x_deadline",
                "traceparent": "traceparent",
            },
        },
    },
)
