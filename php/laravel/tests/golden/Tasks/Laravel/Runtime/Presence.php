<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel\Runtime;

/** Whether a member must be sent. */
enum Presence
{
    case Required;
    case Optional;
}
