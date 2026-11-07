<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests\Runtime;

use Symfony\Component\Security\Core\Authentication\Token\TokenInterface;
use Symfony\Component\Security\Core\Authorization\Voter\Vote;
use Symfony\Component\Security\Core\Authorization\Voter\Voter;

/**
 * A voter that records the attribute and subject it is asked about and grants or denies every one.
 *
 * @extends Voter<string, mixed>
 */
final class RecordingVoter extends Voter
{
    public ?string $attribute = null;
    public mixed $subject = null;

    public function __construct(private readonly bool $grants)
    {
    }

    protected function supports(string $attribute, mixed $subject): bool
    {
        return true;
    }

    protected function voteOnAttribute(string $attribute, mixed $subject, TokenInterface $token, ?Vote $vote = null): bool
    {
        $this->attribute = $attribute;
        $this->subject = $subject;

        return $this->grants;
    }
}
