<?php

declare(strict_types=1);

namespace Seampact\Hooks;

use Seampact\Hooks\RequirementRequest\Extensions;

/** What the decide hook receives for one right or rule; the generated request class narrows each member. */
interface RequirementRequest
{
    /** Whether the requirement is a right or a rule. */
    public function kind(): RequirementKind;

    /** The right's or rule's name. */
    public function name(): string;

    /** The params declared at the use site. */
    public function params(): ?object;

    /** Null for an anonymous caller on a public or optional-auth route. */
    public function principal(): ?object;

    /** Present when the right has a subject. */
    public function subject(): ?SubjectRef;

    /** @return list<ResolvedScope> the resolved scopes, outermost first */
    public function scopes(): array;

    /** The rule's proof, when the rule declares one. */
    public function proof(): mixed;

    /** Present for a throttle rule. */
    public function bucket(): ?ThrottleBucket;

    /** Why the boundary asks. */
    public function purpose(): Purpose;

    /** The operation the hook is called for. */
    public function operation(): OperationRef;

    /** A read-only view of the request. */
    public function request(): RequestView;

    /** The extension values of the right or rule and of the operation. */
    public function extensions(): Extensions;
}
