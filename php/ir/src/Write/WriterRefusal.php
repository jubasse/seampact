<?php

declare(strict_types=1);

namespace Seampact\Ir\Write;

/** Why the writer refuses a write: the codes of the Node writer (`codegen-core`), a message and its fix. */
final readonly class WriterRefusal
{
    public function __construct(public string $code, public string $message, public string $fix)
    {
    }
}
