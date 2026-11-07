<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Illuminate\Pagination\Cursor;
use Illuminate\Pagination\CursorPaginator;
use Illuminate\Pagination\LengthAwarePaginator;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Tests\Support\ReferenceContract;
use Seampact\Laravel\LaravelGenerator;
use Seampact\Laravel\Runtime\PaginatorPages;

/** The `laravelPages` and `laravelCursor` styles of `@seampact/pack-laravel`: the handler answers Laravel's paginator. */
final class PackLaravelPagesTest extends TestCase
{
    private const PACK_LARAVEL = 'pack-laravel';

    public function testAPagedListOfTheLaravelPackAnswersALengthAwarePaginator(): void
    {
        $document = ReferenceContract::kept(ReferenceContract::document(ReferenceContract::TASKS, self::PACK_LARAVEL), ['listTasks']);
        $ir = ReferenceContract::read(new LaravelGenerator(), $document);
        $files = [];
        foreach ((new LaravelGenerator())->generate($ir, ReferenceContract::entry(LaravelGenerator::PACKAGE, 'tasks', 'App\\Tasks')) as $file) {
            $files[$file->path] = $file->contents;
        }

        self::assertArrayNotHasKey('ListTasksPage.php', $files);
        $response = $files['ListTasksResponse200.php'] ?? '';
        self::assertStringContainsString('use Illuminate\\Contracts\\Pagination\\LengthAwarePaginator;', $response);
        self::assertStringContainsString('@param LengthAwarePaginator<int, Task> $body', $response);
    }

    public function testTheBoundaryReadsTheItemsAndTotalOrCursorsOfAPaginator(): void
    {
        $reader = new PaginatorPages();

        self::assertSame(['items' => ['a', 'b'], 'total' => 7], $reader->factsOf(new LengthAwarePaginator(['a', 'b'], 7, 2, 1)));

        $cursorPage = $reader->factsOf(new CursorPaginator([['id' => 1], ['id' => 2], ['id' => 3]], 2, new Cursor(['id' => 0]), ['parameters' => ['id']]));
        self::assertSame([['id' => 1], ['id' => 2]], $cursorPage['items'] ?? null);
        self::assertIsString($cursorPage['nextCursor'] ?? null);
        self::assertNull($reader->factsOf(new \stdClass()));
    }
}
