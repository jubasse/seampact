<?php

declare(strict_types=1);

namespace Seampact\Laravel\Runtime;

use Illuminate\Validation\ClosureValidationRule;
use Seampact\Codegen\Runtime\AccessSteps;
use Seampact\Codegen\Runtime\AppRuleName;
use Seampact\Codegen\Runtime\BoundaryFailure;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\ContractRefusal;
use Seampact\Codegen\Runtime\IdempotencyStep;

/**
 * Step 8b (ADR 0028), after the idempotency claim and before the handler: the app's input rules of the operation run
 * through Laravel's validator over each part's wire-keyed array. A refusal releases the idempotency claim and answers
 * the operation's `schemaInvalid` role with every failed rule of every part, each named `app.<name>`; a rule that
 * throws is the api's 500, logged with the operation and the part, its message never in the reply.
 */
final class InputRulesStep
{
    private const ANONYMOUS_CLASS_MARK = '@anonymous';
    private const MESSAGE_ONLY_RULE = 'errors()->add()';
    private const NAME_FIX = "name the rule: write a class implementing ValidationRule (its short name, first letter lowered, is the name: EndAfterStart gives 'app.endAfterStart') and use it in rules(); a closure, an anonymous class and errors()->add() have no name";

    private function __construct()
    {
    }

    /** @throws ContractRefusal an input rule failed */
    public static function run(BoundaryState $state, object $input): void
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
                throw new \LogicException('seampact: the service tagged \'' . Hooks::inputRulesTag($state->contract->api) . '\' is ' . get_debug_type($rules) . ", not a class implementing {$interface}; tag only the input rules of this api.");
            }
            if ($rules->operationId() === $state->operationId) {
                $issues = [...$issues, ...self::issuesOf($state, $hooks, $input, $rules)];
            }
        }

        if ($issues === []) {
            return;
        }

        IdempotencyStep::abandon($state);

        throw AccessSteps::schemaInvalid($state, FormSteps::rendered($issues));
    }

    /** @return list<array{in: string, pointer: string, rule: string}> */
    private static function issuesOf(BoundaryState $state, Hooks $hooks, object $input, InputRules $rules): array
    {
        $part = $rules->part();
        // Outside the `try`: a fault in the copy is seampact's own 500, not the app's rule.
        $data = InputPartData::of($state, $input, $part);

        try {
            $validator = $hooks->validators()->make($data, $rules->rules());
            // `failed()` holds the rules only once the validator ran.
            $failed = $validator->fails() ? $validator->failed() : [];
            // A message added with `errors()->add()` has no `failed()` entry.
            $messageOnly = array_diff($validator->errors()->keys(), array_keys($failed));
        } catch (\Throwable $failure) {
            throw new BoundaryFailure($failure, "an input rule of the part '{$part}' threw");
        }

        $issues = [];
        foreach ($failed as $attribute => $failedRules) {
            foreach (is_array($failedRules) ? array_keys($failedRules) : [] as $failedRule) {
                $issues[] = self::issueAt($state, $part, (string) $attribute, self::readable((string) $failedRule), self::nameOf((string) $failedRule));
            }
        }
        foreach ($messageOnly as $attribute) {
            $issues[] = self::issueAt($state, $part, (string) $attribute, self::MESSAGE_ONLY_RULE, null);
        }

        return $issues;
    }

    /** @return array{in: string, pointer: string, rule: string} */
    private static function issueAt(BoundaryState $state, string $part, string $attribute, string $description, ?string $name): array
    {
        [$issuePart, $pointer] = InputTree::placeOf($attribute === '' ? $part : "{$part}.{$attribute}");
        $rule = AppRuleName::rendered($state, "{$part}.{$attribute}: {$description}", $name, self::NAME_FIX);

        return ['in' => $issuePart, 'pointer' => $pointer, 'rule' => $rule];
    }

    // An anonymous class's name holds a NUL byte and its file path; the log keeps `Parent@anonymous`.
    private static function readable(string $failedRule): string
    {
        $mark = strpos($failedRule, self::ANONYMOUS_CLASS_MARK);

        return $mark === false ? $failedRule : substr($failedRule, 0, $mark + strlen(self::ANONYMOUS_CLASS_MARK));
    }

    // `failed()` keys a rule object by its class and a built-in rule by its name (`After`); a closure and an anonymous
    // class have no name of their own.
    private static function nameOf(string $failedRule): ?string
    {
        if ($failedRule === ClosureValidationRule::class || str_contains($failedRule, self::ANONYMOUS_CLASS_MARK)) {
            return null;
        }

        $separator = strrpos($failedRule, '\\');

        return lcfirst($separator === false ? $failedRule : substr($failedRule, $separator + 1));
    }
}
