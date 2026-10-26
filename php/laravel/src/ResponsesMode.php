<?php

declare(strict_types=1);

namespace Seampact\Laravel;

/** What a reply outside the contract does (ADR 0016 "Target options"): the api's 500, or a log line. */
enum ResponsesMode: string
{
    case Strict = 'strict';
    case Warn = 'warn';
}
