<?php

declare(strict_types=1);

namespace Seampact\Hooks;

/** How a signature scheme writes its MAC in the header. */
enum SignatureEncoding: string
{
    case Hex = 'hex';
    case Base64 = 'base64';
}
