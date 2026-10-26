<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel\Runtime;

use Illuminate\Http\Request;

/** Step 1's decoding stored as the request's input tree, which the FormRequest's rules read in step 6. */
final class InputStep
{
    private function __construct()
    {
    }

    /** @throws ContractRefusal */
    public static function read(Request $request, BoundaryState $state): void
    {
        $decoded = InputDecoding::read($request, $state);
        $tree = $state->body === null
            ? InputTree::withoutBody($decoded->path, $decoded->query, $decoded->headers)
            : InputTree::withBody($decoded->path, $decoded->query, $decoded->headers, $state->body);
        $request->attributes->set(InputTree::attributeName($state->contract->api), $tree);
    }
}
