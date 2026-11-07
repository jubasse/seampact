<?php

declare(strict_types=1);

namespace Seampact\Codegen;

/**
 * The full names of the runtime classes generated code imports from the installed packages (ADR 0025 "The runtime
 * packages"): a target's own runtime first, then the shared one of `seampact/codegen`. A name neither holds is a
 * generator bug, refused by name.
 */
final readonly class RuntimeClasses
{
    private const SHARED_NAMESPACE = 'Seampact\\Codegen\\Runtime';
    private const SHARED_DIRECTORY = __DIR__ . '/../runtime';

    /** @param string $targetDirectory the directory holding the sources of `$targetNamespace` */
    public function __construct(private string $targetNamespace, private string $targetDirectory)
    {
    }

    public function name(string $simpleName): string
    {
        // The source files, not the autoloader: a runtime class may extend a framework class the generator lacks.
        if (is_file("{$this->targetDirectory}/{$simpleName}.php")) {
            return "{$this->targetNamespace}\\{$simpleName}";
        }

        if (is_file(self::SHARED_DIRECTORY . "/{$simpleName}.php")) {
            return self::SHARED_NAMESPACE . "\\{$simpleName}";
        }

        throw new \LogicException("No runtime class {$simpleName} exists in {$this->targetNamespace} or " . self::SHARED_NAMESPACE . '; the generator names a class its runtime lacks.');
    }
}
