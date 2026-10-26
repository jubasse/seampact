<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony\Runtime;

/** Whether a member must be present; an explicit null is present. */
enum Presence
{
    case Required;
    case Optional;
}
