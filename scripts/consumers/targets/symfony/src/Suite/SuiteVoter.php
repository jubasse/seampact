<?php

declare(strict_types=1);

namespace App\Suite;

use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\Security\Core\Authentication\Token\TokenInterface;
use Symfony\Component\Security\Core\Authorization\Voter\Vote;
use Symfony\Component\Security\Core\Authorization\Voter\Voter;

/**
 * The app's voter of the rights the tasks decider asks through `isGranted`: it grants every right, except the one the
 * `X-Suite-Voter-Deny` header names, as a voter that reads the subject's params and scopes would deny it.
 *
 * @extends Voter<string, DecisionSubject>
 */
final class SuiteVoter extends Voter
{
    public const DENY_HEADER = 'x-suite-voter-deny';

    public function __construct(private readonly RequestStack $requests)
    {
    }

    protected function supports(string $attribute, mixed $subject): bool
    {
        return $subject instanceof DecisionSubject;
    }

    protected function voteOnAttribute(string $attribute, mixed $subject, TokenInterface $token, ?Vote $vote = null): bool
    {
        return $this->requests->getMainRequest()?->headers->get(self::DENY_HEADER) !== $attribute;
    }
}
