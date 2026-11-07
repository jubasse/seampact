<?php

declare(strict_types=1);

namespace Seampact\Symfony\Runtime;

use Symfony\Component\Validator\Attribute\HasNamedArguments;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintViolationInterface;

/**
 * One generated check's issue, added at the member's pointer with its contract rule in the `payload`, as Symfony's
 * own constraints carry theirs, so the boundary reads every violation's rule the same way. Its message names the
 * rule only: a violation message is never rendered or logged, since Symfony's can quote the value.
 */
final class Issue extends Constraint
{
    public const MESSAGE = 'The value breaks the contract rule {{ rule }}.';

    #[HasNamedArguments]
    public function __construct(public readonly string $rule)
    {
        parent::__construct(null, null, Rule::payload($rule));
    }

    /** The contract rule of a violation the generated input constraint raised, from its constraint's `payload`. */
    public static function ruleOf(ConstraintViolationInterface $violation): string
    {
        $payload = $violation->getConstraint()?->payload;
        $rule = is_array($payload) ? ($payload[Rule::PAYLOAD_KEY] ?? null) : null;
        if (!is_string($rule)) {
            throw new \LogicException('A violation of the contract input carries no contract rule in its constraint payload; every constraint the generated code adds sets one, so regenerate the code.');
        }

        return $rule;
    }
}
