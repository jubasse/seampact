<?php

declare(strict_types=1);

namespace Seampact\Codegen\Runtime;

/**
 * The input rule problems of the boot check (ADR 0028 "The boot check"): a registered service that is no rule set,
 * rules for an operation the api lacks, for a part the operation has no input in, for a relay operation, and two rule
 * sets for one operation and part. Rules are optional, so having none is no problem.
 */
final class InputRuleCheck
{
    private const BODY = 'body';
    private const LISTED_PARTS = ['path', 'query', 'headers'];
    private const BODY_KINDS_WITH_MEMBERS = ['ref', 'array'];

    private function __construct()
    {
    }

    /**
     * @param class-string<InputRuleSet> $ruleInterface the api's rule interface the services must implement
     * @param string $registrationFix how the app registers its input rules, ending the problem line
     * @return list<string>
     */
    public static function problems(InputRulesLookup $lookup, ApiContract $contract, string $ruleInterface, string $registrationFix): array
    {
        $problems = [];
        $claimed = [];
        foreach ($lookup->inputRules($contract) as $rules) {
            if (!$rules instanceof $ruleInterface) {
                $problems[] = 'the input rules service ' . get_debug_type($rules) . " does not implement {$ruleInterface}: implement it, or {$registrationFix}";
                continue;
            }

            $problem = self::problemOf($contract, $rules);
            if ($problem !== null) {
                $problems[] = $problem;
                continue;
            }

            $slot = $rules->operationId() . '.' . $rules->part();
            if (isset($claimed[$slot])) {
                $problems[] = "two input rule sets claim the part '{$rules->part()}' of operation '{$rules->operationId()}': {$claimed[$slot]} and " . $rules::class . '; keep one, or merge their rules';
            }
            $claimed[$slot] = $rules::class;
        }

        return $problems;
    }

    private static function problemOf(ApiContract $contract, InputRuleSet $rules): ?string
    {
        $class = $rules::class;
        $operationId = $rules->operationId();
        $part = $rules->part();

        if (!in_array($operationId, $contract->operationIds(), true)) {
            return "{$class} has input rules for operation '{$operationId}', which api '{$contract->api}' lacks or whose entry's `operations` filter drops: fix the operation id, or remove the rules";
        }

        $operation = $contract->operation($operationId);
        $relayed = Ir::map($operation, 'relays');
        if ($relayed !== []) {
            return "{$class} has input rules for operation '{$operationId}', which relays '" . Ir::string($relayed, 'id') . "' of api '" . Ir::string($relayed, 'api') . "': a relay operation takes no rules, put them on the public operation in the gateway";
        }

        if ($part === self::BODY) {
            return self::bodyProblem($class, $operationId, $operation);
        }

        if (!in_array($part, self::LISTED_PARTS, true) || !Ir::has(Ir::map($contract->operationTypes($operationId), 'parts'), $part)) {
            return "{$class} has input rules for the part '{$part}' of operation '{$operationId}', which has no input there: name a part with input (" . implode(', ', self::partsWithInput($contract, $operationId, $operation)) . ')';
        }

        return null;
    }

    /** @param array<array-key, mixed> $operation */
    private static function bodyProblem(string $class, string $operationId, array $operation): ?string
    {
        $input = Ir::map($operation, 'input');
        if ($input === []) {
            return "{$class} has input rules for the part 'body' of operation '{$operationId}', which has no body: remove the rules";
        }

        if (!in_array(Ir::string(Ir::map($input, 'schema'), 'kind'), self::BODY_KINDS_WITH_MEMBERS, true)) {
            return "{$class} has input rules for the body of operation '{$operationId}', which is neither an object nor a list: check that value in the handler";
        }

        return null;
    }

    /**
     * @param array<array-key, mixed> $operation
     * @return list<string>
     */
    private static function partsWithInput(ApiContract $contract, string $operationId, array $operation): array
    {
        $parts = array_values(array_filter(self::LISTED_PARTS, static fn (string $part): bool => Ir::has(Ir::map($contract->operationTypes($operationId), 'parts'), $part)));

        return Ir::has($operation, 'input') ? [...$parts, self::BODY] : $parts;
    }
}
