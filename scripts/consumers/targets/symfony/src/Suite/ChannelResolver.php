<?php

declare(strict_types=1);

namespace App\Suite;

use App\Generated\Tasks\Symfony\Runtime\Denial;
use App\Generated\Tasks\Symfony\Runtime\ScopeResolver;
use Seampact\ConsumerSuite\SuiteControl;
use Seampact\Hooks\ResolvedScope;
use Seampact\Hooks\ResolveScopeRequest;
use Seampact\Hooks\ScopeIdSource;
use Seampact\Hooks\ScopeResolution;
use Symfony\Component\Security\Core\Exception\AccessDeniedException;

/** Resolves a declared channel id to itself, every channel existing, unless the script denies the scope. */
final class ChannelResolver implements ScopeResolver
{
    /** The channel whose resolution throws Symfony's `AccessDeniedException`, as a voter called by a resolver would. */
    public const ACCESS_DENIED_CHANNEL = '10000000-0000-4000-8000-0000000000ad';

    public function scope(): string
    {
        return 'channel';
    }

    public function resolveScope(ResolveScopeRequest $request): ScopeResolution
    {
        $source = $request->source();
        if (!$source instanceof ScopeIdSource\Declared) {
            throw new \LogicException("the consumer resolves declared scope ids only, not those of '{$request->scope()}'");
        }

        if ($source->id === self::ACCESS_DENIED_CHANNEL) {
            throw new AccessDeniedException('the voter denies this channel');
        }

        $denied = SuiteControl::scriptedScopeDenial($request->scope());
        if ($denied !== null) {
            return new ScopeResolution\Denied(new Denial($denied));
        }

        return new ScopeResolution\Resolved(new ResolvedScope($request->scope(), $source->id));
    }
}
