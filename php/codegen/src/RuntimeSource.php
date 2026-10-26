<?php

declare(strict_types=1);

namespace Seampact\Codegen;

/** One directory of runtime sources that a target copies into the app: the namespace they declare and the package shipping them. */
final readonly class RuntimeSource
{
    /**
     * @param string $namespace the namespace every source of the directory declares
     * @param string $package the Composer package that ships the sources, named in the fix
     */
    public function __construct(public string $namespace, public string $directory, public string $package)
    {
    }
}
