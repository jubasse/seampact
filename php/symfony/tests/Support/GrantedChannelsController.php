<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests\Support;

use Seampact\Golden\TasksConsistent\ChannelsEndpoints;
use Seampact\Golden\TasksConsistent\GetChannelInput;
use Seampact\Golden\TasksConsistent\GetChannelResult;
use Seampact\Golden\TasksConsistent\Symfony\SeampactOperation;
use Symfony\Component\Security\Http\Attribute\IsGranted;

/**
 * A controller of the golden `getChannel` operation guarded by `#[IsGranted]`, which the boot check refuses. Only the
 * first attribute is the same check as an access_control rule; the others narrow it, change its denial or need a voter.
 */
final class GrantedChannelsController implements ChannelsEndpoints
{
    public const ROLE = 'ROLE_ADMIN';
    /** The attributes whose fix is a decider: all but the first. */
    public const DECIDER_FIXED_ATTRIBUTES = 5;

    #[SeampactOperation('getChannel')]
    #[IsGranted(self::ROLE)]
    #[IsGranted('CHANNEL_VIEW', subject: 'input')]
    #[IsGranted(self::ROLE, methods: ['DELETE'])]
    #[IsGranted(self::ROLE, statusCode: 404)]
    #[IsGranted(self::ROLE, exceptionCode: 7)]
    #[IsGranted('CHANNEL_VIEW')]
    public function getChannel(GetChannelInput $input): GetChannelResult
    {
        throw new \LogicException('The boot check refuses this controller, so no request reaches it.');
    }
}
