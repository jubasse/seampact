<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Laravel\Runtime;

/**
 * Told of every failure the boundary answers with the api's 500: an exception in a hook or a handler, a reply the
 * outgoing check refuses, a request that bypassed the boundary. An optional container binding.
 */
interface UnexpectedErrorListener
{
    public function onUnexpectedError(UnexpectedFailure $failure): void;
}
