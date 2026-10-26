<?php

declare(strict_types=1);

namespace Seampact\Codegen\Runtime;

use Seampact\Hooks\ResolvedScope;
use Seampact\Hooks\ResolveScopeRequest;
use Seampact\Hooks\ResolveScopeRequest\Extensions;
use Seampact\Hooks\ScopeIdSource;

/** What a scope resolver receives for one scope of an operation. */
final readonly class ScopeCall implements ResolveScopeRequest
{
    /** @param list<ResolvedScope> $outerScopes */
    public function __construct(
        private string $scope,
        private ScopeIdSource $source,
        private ?object $principal,
        private array $outerScopes,
    ) {
    }

    public function scope(): string
    {
        return $this->scope;
    }

    public function source(): ScopeIdSource
    {
        return $this->source;
    }

    public function principal(): ?object
    {
        return $this->principal;
    }

    public function outerScopes(): array
    {
        return $this->outerScopes;
    }

    public function extensions(): Extensions
    {
        return new Extensions(new \stdClass(), new \stdClass());
    }
}
