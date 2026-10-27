<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Symfony;

/**
 * Told of every failure api 'tasks' answers with its 500: alias this interface to your listener.
 */
interface UnexpectedErrorListener extends \Seampact\Codegen\Runtime\UnexpectedErrorListener
{
}
