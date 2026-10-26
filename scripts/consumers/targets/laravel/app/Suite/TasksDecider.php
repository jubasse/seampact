<?php

declare(strict_types=1);

namespace App\Suite;

use App\Generated\Tasks\Laravel\Runtime\Decider;
use App\Generated\Tasks\Laravel\Runtime\Denial;
use Seampact\Hooks\Decision;
use Seampact\Hooks\Purpose;
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

        $denied = SuiteControl::scriptedDecision($request->name(), self::purposeName($request->purpose()));

        return $denied === null ? new Decision\Allowed() : new Decision\Denied(new Denial($denied));
    }

    /** The purpose as the script names it. */
    private static function purposeName(Purpose $purpose): string
    {
        return match (true) {
            $purpose instanceof Purpose\Route => 'route',
            $purpose instanceof Purpose\Field => 'field',
            $purpose instanceof Purpose\SortKey => 'sortKey',
            default => throw new \UnexpectedValueException('the decide request has the unknown purpose ' . $purpose::class),
        };
    }
}
