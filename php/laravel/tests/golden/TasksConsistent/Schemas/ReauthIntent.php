<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Schemas;

/**
 * The values of enum 'ReauthIntent'.
 */
enum ReauthIntent: string
{
    case PurgeTask = 'purge_task';
}
