<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Laravel\Runtime;

/**
 * The hook problems of the boot check (ADR 0016 "The boot check"): an identity without its authenticate hook, a scope
 * without its resolver, a right or rule without a decider, a registered hook of the wrong type, and two deciders
 * claiming one name. Each problem names the hook and the fix the target gives.
 */
final class HookCheck
{
    private function __construct()
    {
    }

    /**
     * @param string $deciderFix how the app registers a decider for a name, ending the problem line
     * @param string $scopeResolverFix how the app registers a scope resolver, ending the problem line
     * @return list<string>
     */
    public static function problems(HookLookup $hooks, ApiContract $contract, string $deciderFix, string $scopeResolverFix): array
    {
        $identities = [];
        $scopes = [];
        $deciderNames = [];
        foreach ($contract->operationIds() as $operationId) {
            $operation = $contract->operation($operationId);
            $identity = Ir::string(Ir::map($operation, 'access'), 'identity');
            if ($identity !== null) {
                $identities[$identity] = true;
            }
            foreach (Ir::maps($operation, 'scopes') as $scope) {
                $scopes[Ir::string($scope, 'scope') ?? ''] = true;
            }
            foreach (Ir::maps($operation, 'requires') as $requirement) {
                $deciderNames[Ir::string($requirement, 'right') ?? Ir::string($requirement, 'rule') ?? ''] = true;
            }
            foreach (Ir::maps($operation, 'fieldRights') as $fieldRight) {
                $deciderNames[Ir::string($fieldRight, 'right') ?? ''] = true;
            }
        }

        $problems = [];
        foreach (array_keys($identities) as $identity) {
            try {
                $hooks->authenticateHook($contract, (string) $identity);
            } catch (\LogicException $missing) {
                $problems[] = $missing->getMessage();
            }
        }

        try {
            foreach (array_keys($scopes) as $scope) {
                if (HookSelection::scopeResolver($hooks, $contract, (string) $scope) === null) {
                    $problems[] = "no scope resolver for the scope '{$scope}': {$scopeResolverFix}";
                }
            }
        } catch (\LogicException $wrongType) {
            $problems[] = $wrongType->getMessage();
        }

        try {
            foreach (array_keys($deciderNames) as $name) {
                if (HookSelection::decider($hooks, $contract, (string) $name) === null) {
                    $problems[] = "no decider for '{$name}': {$deciderFix}";
                }
            }
        } catch (\LogicException $wrongType) {
            $problems[] = $wrongType->getMessage();
        }

        return [...$problems, ...self::claimedTwice($hooks, $contract)];
    }

    /** @return list<string> */
    private static function claimedTwice(HookLookup $hooks, ApiContract $contract): array
    {
        $claimed = [];
        $problems = [];
        foreach ($hooks->deciders($contract) as $decider) {
            if (!$decider instanceof Decider) {
                continue;
            }
            foreach ($decider->names() as $name) {
                if (isset($claimed[$name]) && $claimed[$name] !== $decider::class) {
                    $problems[] = "two deciders claim '{$name}': {$claimed[$name]} and " . $decider::class . '; keep one';
                }
                $claimed[$name] = $decider::class;
            }
        }

        return $problems;
    }
}
