<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel\Runtime;

/**
 * A failure of the boundary's own steps on a contract request (a missing or failing hook, a handler result that is not
 * the operation's): the boundary answers it with the api's 500 whatever the `responses` mode, as no writer wrote it.
 */
final class BoundaryFailure extends \RuntimeException
{
    public function __construct(\Throwable $cause)
    {
        parent::__construct('seampact: a boundary step failed (' . $cause::class . ').', 0, $cause);
    }
}
