<?php

declare(strict_types=1);

namespace App\Suite;

use App\Generated\Tasks\Laravel\Runtime\Decider;
use App\Generated\Tasks\Laravel\Runtime\Denial;
use App\Generated\Tasks\Schemas\ApiRateLimitedParams;
use Seampact\Hooks\Decision;
use Seampact\Hooks\Purpose;
use Seampact\Hooks\RequirementRequest;

/**
 * The `tasks` api's decide double for every right and rule: it spends the throttled user's bucket, denies what the
 * script denies and allows the rest.
 */
final class TasksDecider implements Decider
{
    private const THROTTLE_RULE = 'throttle';
    private const RATE_LIMITED = 'api.rate_limited';

    public function names(): array
    {
        return [self::EVERY_NAME];
    }

    public function decide(RequirementRequest $request): Decision
    {
        SuiteControl::recordHookCall("decide:{$request->name()}", $request->operation()->api, $request->operation()->id);

        $denied = SuiteControl::scriptedDecision($request->name(), self::purposeName($request->purpose()));
        if ($denied === null && $request->name() === self::THROTTLE_RULE && $request->bucket() !== null && self::isThrottledUser($request->principal())) {
            return new Decision\Denied(new Denial(self::RATE_LIMITED, new ApiRateLimitedParams(Credentials::number('throttleRetryAfterMs'))));
        }

        return $denied === null ? new Decision\Allowed() : new Decision\Denied(new Denial($denied));
    }

    // The throttled user's bucket is always spent; every other caller's never is.
    private static function isThrottledUser(?object $principal): bool
    {
        return $principal instanceof UserPrincipal && $principal->userId === Credentials::text('throttledUserId');
    }

    /** The purpose as the script names it. */
    public static function purposeName(Purpose $purpose): string
    {
        return match (true) {
            $purpose instanceof Purpose\Route => 'route',
            $purpose instanceof Purpose\Field => 'field',
            $purpose instanceof Purpose\SortKey => 'sortKey',
            default => throw new \UnexpectedValueException('the decide request has the unknown purpose ' . $purpose::class),
        };
    }
}
