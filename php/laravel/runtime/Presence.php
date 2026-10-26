<?php

declare(strict_types=1);

namespace Seampact\Laravel\Runtime;

/** Whether a member must be sent. */
enum Presence
{
    case Required;
    case Optional;
}
