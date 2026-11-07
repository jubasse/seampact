<?php

declare(strict_types=1);

namespace Seampact\Ir\Config;

/** An entry's view: each api it names with only the operations it keeps, or the problems refusing it. */
final readonly class EntryViewResult
{
    /**
     * @param list<SourceApi> $apis
     * @param list<ConfigProblem> $problems
     */
    public function __construct(public array $apis, public array $problems)
    {
    }
}
