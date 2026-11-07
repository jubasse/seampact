<?php

declare(strict_types=1);

namespace Seampact\Hooks;

/** Whether a field-level requirement guards a request field or a response field. */
enum FieldDirection: string
{
    case Input = 'input';
    case Output = 'output';
}
