<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Symfony\Runtime;

/**
 * Reads the page facts from a framework's own page class a paged list's handler answers (a pack's paging style, such
 * as Laravel's paginators), in place of the generated page class.
 */
interface PageReader
{
    /**
     * The page's items and facts by name, as the generated page class holds them; null when `$page` is not one of the
     * framework's page classes.
     *
     * @return ?array<string, mixed>
     */
    public function factsOf(object $page): ?array;
}
