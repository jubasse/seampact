<?php

declare(strict_types=1);

namespace Seampact\Symfony\Runtime;

/** Whether a present member may be null. */
enum Nullability
{
    case Nullable;
    case NotNull;
}
