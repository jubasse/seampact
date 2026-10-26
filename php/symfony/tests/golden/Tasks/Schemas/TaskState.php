<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Schemas;

/**
 * The values of enum 'TaskState'.
 */
enum TaskState: string
{
    case Open = 'open';
    case Done = 'done';
    case Archived = 'archived';
}
