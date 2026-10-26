<?php

declare(strict_types=1);

namespace App\Suite;

use App\Generated\Tasks\Symfony\Runtime\Decider;
use App\Generated\Tasks\Symfony\Runtime\Denial;
use Seampact\ConsumerSuite\DecisionPurpose;
use Seampact\ConsumerSuite\SuiteControl;
use Seampact\Hooks\Decision;
use Seampact\Hooks\RequirementRequest;

/** The `tasks` api's decide double for every right and rule: it denies what the script denies and allows the rest. */
final class TasksDecider implements Decider
{
    public function names(): array
    {
        return [self::EVERY_NAME];
    }

    public function decide(RequirementRequest $request): Decision
    {
        SuiteControl::recordHookCall("decide:{$request->name()}", $request->operation()->api, $request->operation()->id);

        $denied = SuiteControl::scriptedDecision($request->name(), DecisionPurpose::name($request->purpose()));

        return $denied === null ? new Decision\Allowed() : new Decision\Denied(new Denial($denied));
    }
}
