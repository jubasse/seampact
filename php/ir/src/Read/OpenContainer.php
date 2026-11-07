<?php

declare(strict_types=1);

namespace Seampact\Ir\Read;

/** An open array or object of a JSON text, with the member or index the scan is in. */
final class OpenContainer
{
    public string $key = '';

    public int $index = 0;

    public function __construct(public readonly bool $isObject)
    {
    }

    public function segment(): string
    {
        return $this->isObject ? $this->key : (string) $this->index;
    }
}
