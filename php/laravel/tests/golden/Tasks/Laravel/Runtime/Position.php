<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel\Runtime;

/** Where a rule's attribute sits: a member of an object, or an item of a list (`*` in the rule key). */
enum Position
{
    case Member;
    case Item;
}
