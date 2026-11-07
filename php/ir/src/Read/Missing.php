<?php

declare(strict_types=1);

namespace Seampact\Ir\Read;

/** The value of a member the document does not have, apart from a member that is JSON null. */
enum Missing
{
    case Absent;
}
