<?php

declare(strict_types=1);

namespace Seampact\Ir\Write;

/** What the writer does with a generated file edited by hand since it was written: refuse, or write over it (`--force`). */
enum HandEditPolicy
{
    case Refuse;
    case Overwrite;
}
