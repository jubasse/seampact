<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/** Where an `extra.seampact.binary` override takes the binary from. */
enum BinaryOverrideSource: string
{
    case Path = 'path';
    case Version = 'version';
    case Url = 'url';
}
