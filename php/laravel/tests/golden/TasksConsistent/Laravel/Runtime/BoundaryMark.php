<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Laravel\Runtime;

use Illuminate\Http\Request;

/**
 * The mark the access middleware puts on a request once steps 2 to 5 admitted it: the operation id, in a request
 * attribute named after the api. A FormRequest refuses any request that does not carry its own operation's mark.
 */
final class BoundaryMark
{
    private function __construct()
    {
    }

    public static function attributeName(string $api): string
    {
        return "seampact.{$api}.operation";
    }

    /** @throws ContractBypassedException the request carries no mark, or the mark of another operation */
    public static function assertMarked(Request $request, string $api, string $operationId): void
    {
        $marked = $request->attributes->get(self::attributeName($api));

        if ($marked !== $operationId) {
            throw new ContractBypassedException(
                "The FormRequest of operation '{$operationId}' ran for a request the access middleware of api '{$api}' did not admit for it. "
                . 'Serve the operation only through its generated route, with the boundary middleware installed.',
            );
        }
    }
}
