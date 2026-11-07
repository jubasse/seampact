<?php

declare(strict_types=1);

namespace Seampact\Ir\Config;

/** One plain scalar or tag of a YAML text, as written, with its 1-based line. */
final readonly class YamlToken
{
    public function __construct(public string $text, public int $line, public YamlTokenKind $kind)
    {
    }
}
