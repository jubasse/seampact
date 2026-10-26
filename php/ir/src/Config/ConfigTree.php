<?php

declare(strict_types=1);

namespace Seampact\Ir\Config;

/**
 * A config value as JSON (objects as `stdClass`), read from a YAML file, and the name of that file in problems.
 * The YAML reader keeps no key positions, so a problem names its file and key path.
 */
final readonly class ConfigTree
{
    public function __construct(public mixed $value, public string $displayName)
    {
    }

    /**
     * `<file> <key path>`.
     *
     * @param list<string|int> $path
     */
    public function whereOf(array $path): string
    {
        return $path === [] ? $this->displayName : $this->displayName . ' ' . KeyPath::format($path);
    }
}
