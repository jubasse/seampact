<?php

declare(strict_types=1);

namespace Seampact\Symfony\Runtime;

/** What an object does with a key its schema does not declare. */
enum KeyPolicy
{
    case Refuse;
    case Keep;
}
