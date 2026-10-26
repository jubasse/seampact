<?php

declare(strict_types=1);

namespace App\Suite;

use App\Generated\TasksService\Laravel\Runtime\Decider;
use App\Generated\TasksService\Laravel\Runtime\Denial;
use App\Generated\TasksService\Laravel\ServicePrincipal;
use App\Generated\TasksService\Schemas\ApiForbiddenParams;
use Seampact\ConsumerSuite\DecisionPurpose;
use Seampact\ConsumerSuite\SuiteControl;
use Seampact\Hooks\Decision;
use Seampact\Hooks\RequirementRequest;

/** The `tasksService` api's decide double: denies what the script denies, else `callerService` for a service its params do not list. */
final class ServiceDecider implements Decider
{
    private const CALLER_SERVICE_RIGHT = 'callerService';

    public function names(): array
    {
        return [self::EVERY_NAME];
    }

    public function decide(RequirementRequest $request): Decision
    {
        SuiteControl::recordHookCall("decide:{$request->name()}", $request->operation()->api, $request->operation()->id);

        $denied = SuiteControl::scriptedDecision($request->name(), DecisionPurpose::name($request->purpose()));
        if ($denied !== null) {
            return new Decision\Denied(new Denial($denied));
        }

        if ($request->name() === self::CALLER_SERVICE_RIGHT && !self::callerAllowed($request)) {
            return new Decision\Denied(new Denial('api.forbidden', new ApiForbiddenParams(null)));
        }

        return new Decision\Allowed();
    }

    private static function callerAllowed(RequirementRequest $request): bool
    {
        $principal = $request->principal();
        $allowed = $request->params()->allowed ?? [];

        return $principal instanceof ServicePrincipal && is_array($allowed) && in_array($principal->service->value, $allowed, true);
    }
}
