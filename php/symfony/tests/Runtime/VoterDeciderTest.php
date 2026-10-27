<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests\Runtime;

use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;
use Seampact\Codegen\Tests\Support\DecidedRight;
use Seampact\Hooks\Decision;
use Seampact\Symfony\Runtime\Hooks;
use Seampact\Symfony\Runtime\VoterDecider;
use Symfony\Component\DependencyInjection\ServiceLocator;
use Symfony\Component\Security\Core\Authentication\Token\Storage\TokenStorage;
use Symfony\Component\Security\Core\Authorization\AccessDecisionManager;
use Symfony\Component\Security\Core\Authorization\AuthorizationChecker;

/**
 * The opt-in voter decider, registered as an app registers it: the voters' answer for the right decides, a denial
 * answers the right's first declared code, and the voters receive the request, with its scopes, as the subject.
 */
final class VoterDeciderTest extends TestCase
{
    public function testARightTheVotersGrantIsAllowed(): void
    {
        $decision = DecidedRight::decide(self::hooks(new RecordingVoter(true)), DecidedRight::call(new \stdClass(), new \stdClass()));

        self::assertInstanceOf(Decision\Allowed::class, $decision);
    }

    public function testARightTheVotersDenyAnswersItsFirstDeclaredCode(): void
    {
        $decision = DecidedRight::decide(self::hooks(new RecordingVoter(false)), DecidedRight::call(new \stdClass(), new \stdClass()));

        self::assertInstanceOf(Decision\Denied::class, $decision);
        self::assertSame(DecidedRight::FIRST_DENIAL_CODE, $decision->deny->code());
    }

    public function testTheVotersReceiveTheRightAndTheRequestWithItsScopeValuesAsTheSubject(): void
    {
        $voter = new RecordingVoter(true);
        $project = new \stdClass();
        $call = DecidedRight::call(new \stdClass(), $project);

        DecidedRight::decide(self::hooks($voter), $call);

        self::assertSame([DecidedRight::RIGHT, $call], [$voter->attribute, $voter->subject]);
        self::assertSame($project, $call->scopes()[1]->value);
    }

    private static function hooks(RecordingVoter $voter): Hooks
    {
        $authorization = new AuthorizationChecker(new TokenStorage(), new AccessDecisionManager([$voter]));

        return new Hooks(new ServiceLocator([]), [new VoterDecider($authorization)], [], null, new NullLogger());
    }
}
