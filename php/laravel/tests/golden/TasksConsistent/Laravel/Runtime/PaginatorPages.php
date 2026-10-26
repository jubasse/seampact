<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Laravel\Runtime;

use Illuminate\Contracts\Pagination\CursorPaginator;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;

/**
 * The page facts of Laravel's paginators, which a handler answers under the `laravelPages` and `laravelCursor` styles
 * of `@seampact/pack-laravel` (ADR 0023 "Paging"): the items, and the total or the encoded cursors. The page and
 * limit the boundary renders are the request's, never the paginator's own.
 */
final class PaginatorPages implements PageReader
{
    public function factsOf(object $page): ?array
    {
        if ($page instanceof LengthAwarePaginator) {
            return ['items' => array_values($page->items()), 'total' => $page->total()];
        }

        if ($page instanceof CursorPaginator) {
            return [
                'items' => array_values($page->items()),
                'nextCursor' => $page->nextCursor()?->encode(),
                'previousCursor' => $page->previousCursor()?->encode(),
            ];
        }

        return null;
    }
}
