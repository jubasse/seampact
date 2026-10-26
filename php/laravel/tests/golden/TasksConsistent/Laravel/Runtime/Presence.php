<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Laravel\Runtime;

/** Whether a member must be sent. */
enum Presence
{
    case Required;
    case Optional;
}
