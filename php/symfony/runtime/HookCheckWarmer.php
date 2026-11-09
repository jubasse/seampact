<?php

declare(strict_types=1);

namespace Seampact\Symfony\Runtime;

use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\HookCheck;
use Seampact\Codegen\Runtime\HookLookup;
use Seampact\Codegen\Runtime\InputRuleCheck;
use Symfony\Component\DependencyInjection\Attribute\Exclude;
use Symfony\Component\HttpKernel\CacheWarmer\CacheWarmerInterface;

/**
 * The hook and input rule part of the api's boot check, a cache warmer that is not optional: `cache:clear` and
 * `cache:warmup` build the container, then ask the registered hooks and input rules, and fail listing every problem, so
 * a deploy that warms its cache never serves without them. The input rules are checked at every level of the check.
 * The boundary asks the same on the first contract request of each container instance.
 */
#[Exclude]
final class HookCheckWarmer implements CacheWarmerInterface
{
    public function __construct(private readonly HookLookup $hooks, private readonly string $contractClass, private readonly WarmerChecks $checks = WarmerChecks::HooksAndInputRules)
    {
    }

    /** @return list<string> the hook problems of the api, with the fix */
    public static function problems(HookLookup $hooks, ApiContract $contract): array
    {
        return [
            ...HookCheck::problems($hooks, $contract, Hooks::AUTHENTICATE_HOOK_FIX, Hooks::DECIDER_FIX, Hooks::SCOPE_RESOLVER_FIX),
            ...HookCheck::idempotencyStoreProblems($hooks, $contract, Hooks::idempotencyStoreFix($contract->api)),
        ];
    }

    /** @return list<string> the input rule problems of the api, with the fix; none for a lookup that registers no input rules */
    public static function inputRuleProblems(HookLookup $hooks, ApiContract $contract): array
    {
        if (!$hooks instanceof Hooks || iterator_to_array($hooks->inputRules($contract), false) === []) {
            return [];
        }

        $interface = $hooks->inputRulesInterface($contract);

        return InputRuleCheck::problems($hooks, $contract, $interface, "tag a class implementing {$interface} with '" . Hooks::tag($contract->api, Hooks::INPUT_RULES_TAG_SUFFIX) . "'");
    }

    /** @param non-empty-list<string> $problems */
    public static function report(ApiContract $contract, array $problems): string
    {
        return "the api '{$contract->api}' cannot start:\n- " . implode("\n- ", $problems);
    }

    public function isOptional(): bool
    {
        return false;
    }

    /** @return list<string> */
    public function warmUp(string $cacheDir, ?string $buildDir = null): array
    {
        $contract = Regeneration::contract($this->contractClass);
        $problems = [...($this->checks === WarmerChecks::HooksAndInputRules ? self::problems($this->hooks, $contract) : []), ...self::inputRuleProblems($this->hooks, $contract)];
        if ($problems !== []) {
            throw new \LogicException('seampact: ' . self::report($contract, $problems));
        }

        return [];
    }
}
