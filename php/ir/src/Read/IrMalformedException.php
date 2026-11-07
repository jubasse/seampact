<?php

declare(strict_types=1);

namespace Seampact\Ir\Read;

/** The text is not JSON, or its JSON is not an IR of this model's shape. */
final class IrMalformedException extends \RuntimeException
{
}
