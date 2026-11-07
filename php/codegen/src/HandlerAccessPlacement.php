<?php

declare(strict_types=1);

namespace Seampact\Codegen;

/** Where a target hands its handler the principal and the scopes: on the generated input, or on its own request class. */
enum HandlerAccessPlacement
{
    /** The input class takes `principal` and `scopes` beside its wire parts (Symfony). */
    case Input;
    /** The target's request class reads them from the boundary state; the input holds the wire parts only (Laravel). */
    case Request;
}
