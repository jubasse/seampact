<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Support;

use Seampact\Codegen\Runtime\AccessSteps;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\HookLookup;
use Seampact\Codegen\Runtime\RequirementCall;
use Seampact\Hooks\Decision;
use Seampact\Hooks\OperationRef;
use Seampact\Hooks\Purpose;
use Seampact\Hooks\RequestView;
use Seampact\Hooks\RequirementKind;
use Seampact\Hooks\ResolvedScope;
use Seampact\Hooks\SubjectRef;

/**
 * The right `tasks.edit` of DecidedRightContract asked through the boundary's decide step, as the PHP targets' framework
 * deciders receive it: a principal, a subject that is the `project` scope, and a second resolved scope `workspace`.
 * Shared by the PHP targets' tests through their `autoload-dev`.
 */
final class DecidedRight
{
    public const RIGHT = 'tasks.edit';
    public const FIRST_DENIAL_CODE = 'tasks.not_editor';
    public const PROJECT_SCOPE = 'project';
    public const PROJECT_ID = 'p1';
    public const WORKSPACE_SCOPE = 'workspace';
    public const WORKSPACE_ID = 'w1';

    private function __construct()
    {
    }

    /** The decide step's answer for the right, with the hooks `$hooks` registers. */
    public static function decide(HookLookup $hooks, RequirementCall $call): Decision
    {
        return AccessSteps::decide(self::state($hooks), $call);
    }

    /** The call of the right: its subject is the `project` scope, which the scope resolver loaded as `$project`. */
    public static function call(object $principal, object $project): RequirementCall
    {
        $scopes = [
            new ResolvedScope(self::WORKSPACE_SCOPE, self::WORKSPACE_ID),
            new ResolvedScope(self::PROJECT_SCOPE, self::PROJECT_ID, $project),
        ];
        $view = new RequestView('PATCH', '/v1/projects/p1/task', []);

        return new RequirementCall(RequirementKind::Right, self::RIGHT, null, $principal, new SubjectRef(self::PROJECT_SCOPE, self::PROJECT_ID), $scopes, null, new Purpose\Route(), new OperationRef('tasks', 'editTask'), $view);
    }

    private static function state(HookLookup $hooks): BoundaryState
    {
        return new BoundaryState(ApiContract::of(DecidedRightContract::class), 'editTask', [], new RequestView('PATCH', '/v1/projects/p1/task', []), $hooks);
    }
}
