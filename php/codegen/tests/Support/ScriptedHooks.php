<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Support;

use Psr\Log\AbstractLogger;
use Psr\Log\LoggerInterface;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\AuthenticateCall;
use Seampact\Codegen\Runtime\Decider;
use Seampact\Codegen\Runtime\HookLookup;
use Seampact\Codegen\Runtime\IdempotencyStoreLookup;
use Seampact\Codegen\Runtime\ScopeResolver;
use Seampact\Codegen\Runtime\UnexpectedErrorListener;
use Seampact\Hooks\AuthenticateHook;
use Seampact\Hooks\AuthenticateRequest;
use Seampact\Hooks\AuthenticateResult;
use Seampact\Hooks\Decision;
use Seampact\Hooks\IdempotencyStore;
use Seampact\Hooks\RequirementRequest;
use Seampact\Hooks\ResolveScopeRequest;
use Seampact\Hooks\ScopeResolution;

/**
 * A hook lookup whose authenticate hook, scope resolver and decider each run a closure the test gives, and whose
 * logger keeps its lines; a closure that throws stands for an app hook that throws.
 */
final class ScriptedHooks implements HookLookup, IdempotencyStoreLookup
{
    /** @var list<string> */
    public array $logged = [];

    /**
     * @param \Closure(AuthenticateRequest): AuthenticateResult $authenticate
     * @param \Closure(ResolveScopeRequest): ScopeResolution $resolveScope
     * @param \Closure(RequirementRequest): Decision $decide
     */
    public function __construct(
        private readonly \Closure $authenticate,
        private readonly \Closure $resolveScope,
        private readonly \Closure $decide,
        private readonly ?IdempotencyStore $store = null,
    ) {
    }

    public static function none(?IdempotencyStore $store = null): self
    {
        $unexpected = static fn (): never => throw new \LogicException('hook not scripted');

        return new self($unexpected, $unexpected, $unexpected, $store);
    }

    public function authenticateHook(ApiContract $contract, string $identity): AuthenticateHook
    {
        return new ScriptedAuthenticateHook($this->authenticate);
    }

    public function deciders(ApiContract $contract): iterable
    {
        $script = $this->decide;

        return [new class ($script) implements Decider {
            /** @param \Closure(RequirementRequest): Decision $script */
            public function __construct(private readonly \Closure $script)
            {
            }

            public function names(): array
            {
                return [Decider::EVERY_NAME];
            }

            public function decide(RequirementRequest $request): Decision
            {
                return ($this->script)($request);
            }
        }];
    }

    public function scopeResolvers(ApiContract $contract): iterable
    {
        $script = $this->resolveScope;

        return [new class ($script) implements ScopeResolver {
            /** @param \Closure(ResolveScopeRequest): ScopeResolution $script */
            public function __construct(private readonly \Closure $script)
            {
            }

            public function scope(): string
            {
                return 'channel';
            }

            public function resolveScope(ResolveScopeRequest $request): ScopeResolution
            {
                return ($this->script)($request);
            }
        }];
    }

    public function unexpectedErrorListener(ApiContract $contract): ?UnexpectedErrorListener
    {
        return null;
    }

    public function logger(): LoggerInterface
    {
        return new class ($this) extends AbstractLogger {
            public function __construct(private readonly ScriptedHooks $hooks)
            {
            }

            public function log($level, string|\Stringable $message, array $context = []): void
            {
                $this->hooks->logged[] = (string) $message;
            }
        };
    }

    public function isAccessDenial(\Throwable $failure): bool
    {
        return $failure instanceof \DomainException;
    }

    public function isNotFoundDenial(\Throwable $failure): bool
    {
        return false;
    }

    public function idempotencyStore(ApiContract $contract): ?IdempotencyStore
    {
        return $this->store;
    }
}
