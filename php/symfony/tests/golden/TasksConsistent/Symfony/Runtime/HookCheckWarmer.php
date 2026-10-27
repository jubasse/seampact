<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony\Runtime;

use Symfony\Component\DependencyInjection\Attribute\Exclude;
use Symfony\Component\HttpKernel\CacheWarmer\CacheWarmerInterface;

/**
 * The hook part of the api's boot check, a cache warmer that is not optional: `cache:clear` and `cache:warmup` build
 * the container, then ask the registered hooks, and fail listing every hook problem, so a deploy that warms its cache
 * never serves without them. The boundary asks the same on the first contract request of each container instance.
 */
#[Exclude]
final class HookCheckWarmer implements CacheWarmerInterface
{
    public function __construct(private readonly HookLookup $hooks, private readonly string $contractClass)
    {
    }

    /** @return list<string> the hook problems of the api, with the fix */
    public static function problems(HookLookup $hooks, ApiContract $contract): array
    {
        return [
            ...HookCheck::problems($hooks, $contract, Hooks::AUTHENTICATE_HOOK_FIX, Hooks::DECIDER_FIX, Hooks::SCOPE_RESOLVER_FIX),
            ...HookCheck::idempotencyStoreProblems($hooks, $contract, Hooks::IDEMPOTENCY_STORE_FIX),
        ];
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
        $contract = ApiContract::of($this->contractClass);
        $problems = self::problems($this->hooks, $contract);
        if ($problems !== []) {
            throw new \LogicException('seampact: ' . self::report($contract, $problems));
        }

        return [];
    }
}
