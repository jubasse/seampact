<?php

declare(strict_types=1);

namespace App\Suite;

use Seampact\Codegen\Runtime\Denial;
use Seampact\Codegen\Runtime\ScopeResolver;
use Seampact\ConsumerSuite\SampleData;
use Seampact\ConsumerSuite\SuiteControl;
use Seampact\Hooks\ResolvedScope;
use Seampact\Hooks\ResolveScopeRequest;
use Seampact\Hooks\ScopeIdSource;
use Seampact\Hooks\ScopeResolution;

/** Resolves a declared channel id to itself and loads its sample channel, every channel existing, unless the script denies the scope. */
final class ChannelResolver implements ScopeResolver
{
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

        $denied = SuiteControl::scriptedScopeDenial($request->scope());
        if ($denied !== null) {
            return new ScopeResolution\Denied(new Denial($denied));
        }

        return new ScopeResolution\Resolved(new ResolvedScope($request->scope(), $source->id, SampleData::channel((string) $source->id)));
    }
}
