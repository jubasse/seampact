<?php

declare(strict_types=1);

namespace Seampact\Symfony\Runtime;

use Seampact\Codegen\Runtime\Decider;
use Seampact\Hooks\Decision;
use Seampact\Hooks\RequirementRequest;
use Symfony\Component\DependencyInjection\Attribute\Exclude;
use Symfony\Component\Security\Core\Authorization\AuthorizationCheckerInterface;
use Symfony\Component\Security\Core\Exception\AccessDeniedException;

/**
 * An opt-in decider that asks the app's voters, so the app answers its rights and rules as Symfony does: it calls
 * `isGranted` with the right or rule name as the attribute and the request as the subject, which carries the params,
 * the subject, the scopes and the principal. A denial throws `AccessDeniedException`, which answers the first declared
 * denial code. The app enables it by registering it as a service tagged with the api's deciders tag; a decider that
 * names a right wins over it.
 */
#[Exclude]
final class VoterDecider implements Decider
{
    public function __construct(private readonly AuthorizationCheckerInterface $authorization)
    {
    }

    public function names(): array
    {
        return [self::EVERY_NAME];
    }

    public function decide(RequirementRequest $request): Decision
    {
        if (!$this->authorization->isGranted($request->name(), $request)) {
            throw new AccessDeniedException("the app's voters deny '{$request->name()}'");
        }

        return new Decision\Allowed();
    }
}
