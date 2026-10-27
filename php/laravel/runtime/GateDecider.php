<?php

declare(strict_types=1);

namespace Seampact\Laravel\Runtime;

use Illuminate\Contracts\Auth\Access\Gate;
use Seampact\Codegen\Runtime\Decider;
use Seampact\Hooks\Decision;
use Seampact\Hooks\RequirementRequest;
use Seampact\Hooks\ResolvedScope;

/**
 * An opt-in decider that asks Laravel's Gate, so the app answers its rights and rules with Policies and `Gate::define()`:
 * the ability is the right or rule name, the user is the principal, and the arguments are the subject first, then the
 * other resolved scopes, then the request. A subject or scope is its loaded record or value, else its id, so a Policy
 * is found by the class of the model the scope resolver loaded. A denial throws `AuthorizationException`, which answers
 * the first declared denial code, or the `notFound` code for `Response::denyAsNotFound()`. The app enables it by
 * tagging it with the api's deciders tag; a decider that names a right wins over it.
 */
final class GateDecider implements Decider
{
    public function __construct(private readonly Gate $gate)
    {
    }

    public function names(): array
    {
        return [self::EVERY_NAME];
    }

    public function decide(RequirementRequest $request): Decision
    {
        $this->gate->forUser($request->principal())->authorize($request->name(), self::abilityArguments($request));

        return new Decision\Allowed();
    }

    /** @return list<mixed> */
    private static function abilityArguments(RequirementRequest $request): array
    {
        $arguments = [];
        $otherScopes = $request->scopes();

        $subject = $request->subject();
        if ($subject !== null) {
            $subjectScope = self::scopeOf($otherScopes, $subject->type, $subject->id);
            $arguments[] = $subject->record ?? $subjectScope->value ?? $subject->id;
            $otherScopes = array_values(array_filter($otherScopes, static fn (ResolvedScope $scope): bool => $scope !== $subjectScope));
        }

        foreach ($otherScopes as $scope) {
            $arguments[] = $scope->value ?? $scope->id;
        }

        $arguments[] = $request;

        return $arguments;
    }

    /** @param list<ResolvedScope> $scopes */
    private static function scopeOf(array $scopes, string $name, int|string|object $id): ?ResolvedScope
    {
        foreach ($scopes as $scope) {
            if ($scope->scope === $name && $scope->id === $id) {
                return $scope;
            }
        }

        return null;
    }
}
