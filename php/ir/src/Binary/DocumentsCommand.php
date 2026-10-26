<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/** The binary's commands on an app config's OpenAPI documents (ADR 0010 "The standalone compiler binary"). */
enum DocumentsCommand: string
{
    case Generate = 'generate';
    case Check = 'check';
}
