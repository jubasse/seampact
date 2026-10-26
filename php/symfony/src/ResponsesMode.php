<?php

declare(strict_types=1);

namespace Seampact\Symfony;

/** What the outgoing response check does with a violation: answer the api's 500, or log it and send the reply. */
enum ResponsesMode: string
{
    case Strict = 'strict';
    case Warn = 'warn';
}
