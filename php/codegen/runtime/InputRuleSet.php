<?php

declare(strict_types=1);

namespace Seampact\Codegen\Runtime;

/**
 * The app's input rules of one operation and one input part (ADR 0028), written in the target's validator library: the
 * boundary runs them at step 8b, after the contract's own checks and the idempotency claim, and a refusal answers the
 * operation's `schemaInvalid` role. Each target adds the call that hands over its library's rules.
 */
interface InputRuleSet
{
    /** The id of the operation the rules apply to. */
    public function operationId(): string;

    /** The input part the rules apply to: `path`, `query`, `headers` or `body`. */
    public function part(): string;
}
