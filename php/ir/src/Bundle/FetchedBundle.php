<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

/** A bundle that passed the pinned-bundle check: its integrity and each api's IR document, by api name. */
final readonly class FetchedBundle
{
    /** @param array<string, \stdClass> $irDocuments */
    public function __construct(public string $integrity, public array $irDocuments)
    {
    }
}
