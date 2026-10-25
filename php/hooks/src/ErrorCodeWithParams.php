<?php

declare(strict_types=1);

namespace Seampact\Hooks;

/** A declared error code and its typed params, the only thing a hook may deny with. */
interface ErrorCodeWithParams
{
    /** The declared code. */
    public function code(): string;

    /** The code's params, null for a code that declares none. */
    public function params(): ?object;
}
