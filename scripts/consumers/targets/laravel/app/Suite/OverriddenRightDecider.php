<?php

declare(strict_types=1);

namespace App\Suite;

use App\Generated\Tasks\Laravel\Runtime\Decider;
use App\Generated\Tasks\Laravel\Runtime\Denial;
use Seampact\ConsumerSuite\DecisionPurpose;
use Seampact\ConsumerSuite\SuiteControl;
use Seampact\Hooks\Decision;
use Seampact\Hooks\RequirementRequest;

/**
 * The app's own decider for the overridden right (CHK-091): it records under its own hook name and denies what the
 * script denies, while every other right and rule reaches the generic decider.
 */
final class OverriddenRightDecider implements Decider
{
    private const OVERRIDDEN_RIGHT = 'tasks.update';

    public function names(): array
    {
        return [self::OVERRIDDEN_RIGHT];
    }

    public function decide(RequirementRequest $request): Decision
    {
        SuiteControl::recordHookCall("decide-override:{$request->name()}", $request->operation()->api, $request->operation()->id);
        $denied = SuiteControl::scriptedDecision($request->name(), DecisionPurpose::name($request->purpose()));

        return $denied === null ? new Decision\Allowed() : new Decision\Denied(new Denial($denied));
    }
}
