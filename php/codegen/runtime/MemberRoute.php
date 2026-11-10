<?php

declare(strict_types=1);

namespace Seampact\Codegen\Runtime;

/**
 * The member route of a resource beside an operation: the path of a route of that resource through its id
 * placeholder, whose parent path the operation's own path starts with. The generator refuses a format that writes a
 * member URL where this finds none, and the boundary builds the URL from the route this finds.
 */
final class MemberRoute
{
    private function __construct()
    {
    }

    /**
     * @param iterable<array{type: ?string, idParam: ?string, path: string}> $routes every operation of the contract
     * @return ?array{path: string, idParam: string}
     */
    public static function find(?string $type, string $ownPath, iterable $routes): ?array
    {
        if ($type === null) {
            return null;
        }

        foreach ($routes as $route) {
            $idParam = $route['idParam'];
            $idStart = $idParam === null ? false : strpos($route['path'], '{' . $idParam . '}');
            if ($route['type'] !== $type || $idParam === null || $idStart === false) {
                continue;
            }

            $memberPath = substr($route['path'], 0, $idStart + strlen($idParam) + 2);
            $parentPath = substr($memberPath, 0, $idStart - 1);
            if ($ownPath === $parentPath || str_starts_with($ownPath, "{$parentPath}/")) {
                return ['path' => $memberPath, 'idParam' => $idParam];
            }
        }

        return null;
    }
}
