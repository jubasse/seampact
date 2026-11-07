<?php

declare(strict_types=1);

namespace Seampact\Ir\Run;

use Seampact\Ir\Config\JsonValue;

/**
 * One item of an entry's `frameworkRoutes`: an app route the boot check lets through, its `path` a pattern where `*`
 * takes one segment and `**` any number, `method` null for every method.
 */
final readonly class FrameworkRoute
{
    public function __construct(public string $path, public string $reason, public ?string $method)
    {
    }

    /**
     * The entry's `frameworkRoutes`, already checked against the app config schema, empty when absent.
     *
     * @return list<self>
     */
    public static function listOf(\stdClass $entry): array
    {
        $routes = [];
        foreach (JsonValue::list($entry, 'frameworkRoutes') ?? [] as $route) {
            $routes[] = new self(JsonValue::string($route, 'path') ?? '', JsonValue::string($route, 'reason') ?? '', JsonValue::string($route, 'method'));
        }

        return $routes;
    }
}
