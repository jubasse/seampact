<?php

declare(strict_types=1);

namespace Seampact\Codegen\Runtime;

/**
 * A failure of the boundary's own steps on a contract request (a missing or failing hook, a handler result that is not
 * the operation's): the boundary answers it with the api's 500 whatever the `responses` mode, as no writer wrote it.
 */
final class BoundaryFailure extends \RuntimeException
{
    public const DEFAULT_REASON = 'a boundary step failed';

    /** @param string $reason what the boundary logs beside the operation, when the step knows more than "a step failed" */
    public function __construct(\Throwable $cause, public readonly string $reason = self::DEFAULT_REASON)
    {
        parent::__construct('seampact: a boundary step failed (' . $cause::class . ').', 0, $cause);
    }
}
