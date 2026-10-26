<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel\Runtime;

use Seampact\Hooks\OperationRef;
use Seampact\Hooks\Purpose;
use Seampact\Hooks\RequestView;
use Seampact\Hooks\RequirementKind;
use Seampact\Hooks\RequirementRequest;
use Seampact\Hooks\RequirementRequest\Extensions;
use Seampact\Hooks\ResolvedScope;
use Seampact\Hooks\SubjectRef;
use Seampact\Hooks\ThrottleBucket;

/** What a decider receives for one right or rule. */
final readonly class RequirementCall implements RequirementRequest
{
    /** @param list<ResolvedScope> $scopes */
    public function __construct(
        private RequirementKind $kind,
        private string $name,
        private ?object $params,
        private ?object $principal,
        private ?SubjectRef $subject,
        private array $scopes,
        #[\SensitiveParameter] private mixed $proof,
        private Purpose $purpose,
        private OperationRef $operation,
        private RequestView $request,
    ) {
    }

    public function kind(): RequirementKind
    {
        return $this->kind;
    }

    public function name(): string
    {
        return $this->name;
    }

    public function params(): ?object
    {
        return $this->params;
    }

    public function principal(): ?object
    {
        return $this->principal;
    }

    public function subject(): ?SubjectRef
    {
        return $this->subject;
    }

    public function scopes(): array
    {
        return $this->scopes;
    }

    public function proof(): mixed
    {
        return $this->proof;
    }

    public function bucket(): ?ThrottleBucket
    {
        return null;
    }

    public function purpose(): Purpose
    {
        return $this->purpose;
    }

    public function operation(): OperationRef
    {
        return $this->operation;
    }

    public function request(): RequestView
    {
        return $this->request;
    }

    public function extensions(): Extensions
    {
        return new Extensions(new \stdClass(), new \stdClass());
    }

    /** @return array<string, mixed> */
    public function __debugInfo(): array
    {
        return ['kind' => $this->kind, 'name' => $this->name, 'proof' => \Seampact\Hooks\Redaction::REDACTED, 'operation' => $this->operation];
    }
}
