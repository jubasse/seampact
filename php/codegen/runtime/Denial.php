<?php

declare(strict_types=1);

namespace Seampact\Codegen\Runtime;

use Seampact\Hooks\ErrorCodeWithParams;

/** A hook's denial: one of the codes the hook's declaration lists, with the code's params when it has any. */
final readonly class Denial implements ErrorCodeWithParams
{
    public function __construct(private string $code, private ?object $params = null)
    {
    }

    public function code(): string
    {
        return $this->code;
    }

    public function params(): ?object
    {
        return $this->params;
    }
}
