<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony\Runtime;

/** Whether a member may be sent as JSON null. */
enum Nullability
{
    case Nullable;
    case NotNull;
}
