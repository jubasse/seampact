<?php

declare(strict_types=1);

namespace App\Suite;

use App\Generated\TasksService\Schemas\ApiForbiddenParams;
use App\Generated\TasksService\Schemas\CallerServiceParams;
use App\Generated\TasksService\Symfony\Decider;
use App\Generated\TasksService\Symfony\ServicePrincipal;
use App\Generated\TasksServiceWrites\Schemas\ApiForbiddenParams as WritesApiForbiddenParams;
use App\Generated\TasksServiceWrites\Schemas\CallerServiceParams as WritesCallerServiceParams;
use App\Generated\TasksServiceWrites\Symfony\Decider as WritesDecider;
use App\Generated\TasksServiceWrites\Symfony\ServicePrincipal as WritesServicePrincipal;
use Seampact\Codegen\Runtime\Denial;
use Seampact\ConsumerSuite\DecisionPurpose;
use Seampact\ConsumerSuite\SuiteControl;
use Seampact\Hooks\Decision;
use Seampact\Hooks\RequirementRequest;

/** The decide double of the `tasksService` and `tasksServiceWrites` apis: denies what the script denies, else `callerService` for a service its params do not list. */
final class ServiceDecider implements Decider, WritesDecider
{
    private const CALLER_SERVICE_RIGHT = 'callerService';

    public function names(): array
    {
        return [self::EVERY_NAME];
    }

    public function decide(RequirementRequest $request): Decision
    {
        SuiteControl::recordHookCall("decide:{$request->name()}", $request->operation()->api, $request->operation()->id, $request->bucket());
        SuiteControl::throwScriptedHookFailure("decide:{$request->name()}");

        $denied = SuiteControl::scriptedDecision($request->name(), DecisionPurpose::name($request->purpose()));
        if ($denied !== null) {
            return new Decision\Denied(new Denial($denied));
        }

        if ($request->name() === self::CALLER_SERVICE_RIGHT && !self::callerAllowed($request)) {
            $params = $request->principal() instanceof WritesServicePrincipal ? new WritesApiForbiddenParams(null) : new ApiForbiddenParams(null);

            return new Decision\Denied(new Denial('api.forbidden', $params));
        }

        return new Decision\Allowed();
    }

    private static function callerAllowed(RequirementRequest $request): bool
    {
        $principal = $request->principal();
        $params = $request->params();

        if ($principal instanceof WritesServicePrincipal) {
            return $params instanceof WritesCallerServiceParams && in_array($principal->service, $params->allowed, true);
        }

        return $principal instanceof ServicePrincipal && $params instanceof CallerServiceParams && in_array($principal->service, $params->allowed, true);
    }
}
