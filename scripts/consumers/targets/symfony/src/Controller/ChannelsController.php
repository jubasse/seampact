<?php

declare(strict_types=1);

namespace App\Controller;

use App\Generated\Tasks\ChannelsEndpoints;
use App\Generated\Tasks\GetChannelResponse200;
use App\Generated\Tasks\GetChannelResult;
use App\Generated\Tasks\GetChannelInput;
use App\Generated\Tasks\Symfony\Runtime\SeampactOperation;
use App\Suite\SampleData;
use App\Suite\ScriptedAnswers;

final class ChannelsController implements ChannelsEndpoints
{
    #[SeampactOperation('getChannel')]
    public function getChannel(GetChannelInput $input): GetChannelResult
    {
        return ScriptedAnswers::answer('getChannel', 200, static fn (array $body): GetChannelResult => new GetChannelResponse200(SampleData::channelOf($body)))
            ?? new GetChannelResponse200(SampleData::channel($input->path->channelId));
    }
}
