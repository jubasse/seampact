<?php

declare(strict_types=1);

namespace Seampact\Ir\Config;

/**
 * One api a source holds, as its IR JSON document decoded with objects as `stdClass`: what a bundle check or the
 * binary's compile gives. The document is the holder's own copy.
 */
final readonly class SourceApi
{
    public function __construct(public string $source, public string $api, public \stdClass $ir)
    {
    }
}
