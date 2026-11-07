<?php

declare(strict_types=1);

namespace Seampact\Ir\Naming;

/** The case of an operation id, `conventions.operationIds.case` (ADR 0002 section 13). */
enum OperationIdCase: string
{
    case Camel = 'camel';
    case Snake = 'snake';
}
