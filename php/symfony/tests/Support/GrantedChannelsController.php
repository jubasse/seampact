<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests\Support;

use Seampact\Golden\TasksConsistent\ChannelsEndpoints;
use Seampact\Golden\TasksConsistent\GetChannelInput;
use Seampact\Golden\TasksConsistent\GetChannelResult;
use Seampact\Golden\TasksConsistent\Symfony\SeampactOperation;
use Symfony\Component\Security\Http\Attribute\IsGranted;

/** A controller of the golden `getChannel` operation guarded by `#[IsGranted]`, which the boot check refuses. */
final class GrantedChannelsController implements ChannelsEndpoints
{
    public const ROLE = 'ROLE_ADMIN';

    #[SeampactOperation('getChannel')]
    #[IsGranted(self::ROLE)]
    #[IsGranted('CHANNEL_VIEW', subject: 'input')]
    public function getChannel(GetChannelInput $input): GetChannelResult
    {
        throw new \LogicException('The boot check refuses this controller, so no request reaches it.');
    }
}
