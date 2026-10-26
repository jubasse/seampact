<?php

declare(strict_types=1);

namespace App\Suite;

use App\Generated\Tasks\Schemas\ApiRateLimitedParams;
use App\Generated\Tasks\Symfony\Runtime\Decider;
use App\Generated\Tasks\Symfony\Runtime\Denial;
use App\Generated\Tasks\Symfony\UserPrincipal;
use Seampact\ConsumerSuite\Credentials;
use Seampact\ConsumerSuite\DecisionPurpose;
use Seampact\ConsumerSuite\SuiteControl;
use Seampact\Hooks\Decision;
use Seampact\Hooks\RequirementRequest;
use Seampact\Hooks\ThrottleBucket;
use Symfony\Component\RateLimiter\RateLimiterFactoryInterface;

/**
 * The `tasks` api's decide double for every right and rule: the throttle rule counts the throttled user's bucket in
 * the app's `suite_throttle` rate limiter, keyed by the boundary's bucket key, denies what the script denies and
 * allows the rest.
 */
final class TasksDecider implements Decider
{
    private const THROTTLE_RULE = 'throttle';
    private const RATE_LIMITED = 'api.rate_limited';

    public function __construct(private readonly RateLimiterFactoryInterface $suiteThrottleLimiter)
    {
    }

    public function names(): array
    {
        return [self::EVERY_NAME];
    }

    public function decide(RequirementRequest $request): Decision
    {
        SuiteControl::recordHookCall("decide:{$request->name()}", $request->operation()->api, $request->operation()->id);

        $denied = SuiteControl::scriptedDecision($request->name(), DecisionPurpose::name($request->purpose()));
        $bucket = $request->bucket();
        if ($denied === null && $request->name() === self::THROTTLE_RULE && $bucket !== null && self::isThrottledUser($request->principal()) && $this->spent($bucket)) {
            return new Decision\Denied(new Denial(self::RATE_LIMITED, new ApiRateLimitedParams(Credentials::number('throttleRetryAfterMs'))));
        }

        return $denied === null ? new Decision\Allowed() : new Decision\Denied(new Denial($denied));
    }

    // The limiter allows one request a window, so the throttled user's bucket is spent by its first request at the latest.
    private function spent(ThrottleBucket $bucket): bool
    {
        $limiter = $this->suiteThrottleLimiter->create($bucket->key);

        return !$limiter->consume()->isAccepted() || !$limiter->consume()->isAccepted();
    }

    // Only the throttled user's requests are counted; every other caller's bucket is never spent.
    private static function isThrottledUser(?object $principal): bool
    {
        return $principal instanceof UserPrincipal && $principal->userId === Credentials::text('throttledUserId');
    }
}
