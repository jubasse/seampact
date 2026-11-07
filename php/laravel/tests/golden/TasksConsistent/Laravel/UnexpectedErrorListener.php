<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Laravel;

/**
 * Told of every failure api 'tasks' answers with its 500: bind your listener to this interface.
 */
interface UnexpectedErrorListener extends \Seampact\Codegen\Runtime\UnexpectedErrorListener
{
}
