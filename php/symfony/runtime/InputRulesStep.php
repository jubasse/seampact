<?php

declare(strict_types=1);

namespace Seampact\Symfony\Runtime;

use Seampact\Codegen\Runtime\AccessSteps;
use Seampact\Codegen\Runtime\AppRuleName;
use Seampact\Codegen\Runtime\BoundaryFailure;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\ContractRefusal;
use Seampact\Codegen\Runtime\IdempotencyStep;
use Symfony\Component\Validator\ConstraintViolationInterface;
use Symfony\Component\Validator\Validator\ValidatorInterface;

/**
 * Step 8b (ADR 0028), after the idempotency claim and before the handler: the app's input rules of the operation run
 * through the validator over the input's typed part objects, which are readonly. A refusal releases the idempotency
 * claim and answers the operation's `schemaInvalid` role with every violation of every part, each named
 * `app.<name>`; a rule that throws is the api's 500, logged with the operation and the part, its message never in the
 * reply.
 */
final class InputRulesStep
{
    private const ISSUE_PART_ORDER = ['path', 'query', 'header', 'body'];
    private const NAME_FIX = "name the rule: set the constraint's payload ['rule' => 'name'], call setCode('name') on the violation, or write a custom Constraint class (its short name, first letter lowered, is the name: EndAfterStart gives 'app.endAfterStart'); a built-in constraint has no name";

    private function __construct()
    {
    }

    /** @throws ContractRefusal an input rule failed */
    public static function run(BoundaryState $state, object $input, ValidatorInterface $validator): void
    {
        $hooks = $state->hooks;
        // Only the container's hooks register input rules; any other lookup has none.
        if (!$hooks instanceof Hooks) {
            return;
        }

        $issues = [];
        foreach ($hooks->inputRules($state->contract) as $rules) {
            $interface = $hooks->inputRulesInterface($state->contract);
            if (!$rules instanceof InputRules || !$rules instanceof $interface) {
                throw new \LogicException('seampact: the service tagged \'' . Hooks::tag($state->contract->api, Hooks::INPUT_RULES_TAG_SUFFIX) . '\' is ' . get_debug_type($rules) . ", not a class implementing {$interface}; tag only the input rules of this api.");
            }
            if ($rules->operationId() === $state->operationId) {
                $issues = [...$issues, ...self::issuesOf($state, $validator, $input, $rules)];
            }
        }

        if ($issues === []) {
            return;
        }

        IdempotencyStep::abandon($state);
        // A stable sort: within a part, the issues keep the order they were found in.
        usort($issues, static fn (array $first, array $second): int => array_search($first['in'], self::ISSUE_PART_ORDER, true) <=> array_search($second['in'], self::ISSUE_PART_ORDER, true));

        throw AccessSteps::schemaInvalid($state, BoundarySubscriber::renderedIssues($issues));
    }

    /** @return list<array{in: string, pointer: string, rule: string}> */
    private static function issuesOf(BoundaryState $state, ValidatorInterface $validator, object $input, InputRules $rules): array
    {
        $part = $rules->part();
        // Outside the `try`: a fault in the copy is seampact's own 500, not the app's rule.
        $held = get_object_vars($input)[$part] ?? null;
        if ($held === null) {
            return [];
        }

        try {
            $violations = $validator->validate($held, $rules->constraints());
        } catch (\Throwable $failure) {
            throw new BoundaryFailure($failure, "an input rule of the part '{$part}' threw (" . get_debug_type($rules) . ')');
        }

        $issues = [];
        foreach ($violations as $violation) {
            $issues[] = self::issueOf($state, $part, $violation);
        }

        return $issues;
    }

    /** @return array{in: string, pointer: string, rule: string} */
    private static function issueOf(BoundaryState $state, string $part, ConstraintViolationInterface $violation): array
    {
        $path = $violation->getPropertyPath();
        $place = InputPointer::of($state->contract, $state->operationId, $part, $path);
        $constraint = $violation->getConstraint();
        $description = $constraint === null ? 'a violation without a constraint' : get_debug_type($constraint);
        $rule = AppRuleName::rendered($state, "{$part}.{$path}: {$description}", AppConstraintName::of($violation), self::NAME_FIX);

        return ['in' => $place['in'], 'pointer' => $place['pointer'], 'rule' => $rule];
    }
}
