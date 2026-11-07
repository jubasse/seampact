<?php

declare(strict_types=1);

namespace Seampact\Symfony\Runtime;

use Seampact\Codegen\Runtime\ApiContract;
use Symfony\Component\Console\Input\ArgvInput;

/**
 * The run of `bin/console seampact:generate`, read from the command line at each call and never stored: the runtime
 * version check steps aside there, so the command that fixes a version skew can run. Every other check runs as before.
 */
final class Regeneration
{
    public const COMMAND = 'seampact:generate';

    private function __construct()
    {
    }

    public static function contract(string $contractClass): ApiContract
    {
        return (new ArgvInput())->getFirstArgument() === self::COMMAND ? ApiContract::forRegeneration($contractClass) : ApiContract::of($contractClass);
    }
}
