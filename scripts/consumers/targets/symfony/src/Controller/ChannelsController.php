<?php

declare(strict_types=1);

namespace App\Controller;

use App\Generated\Tasks\ChannelsEndpoints;
use App\Generated\Tasks\GetChannelInput;
use App\Generated\Tasks\GetChannelResponse200;
use App\Generated\Tasks\GetChannelResult;
use App\Generated\Tasks\ListChannelsInput;
use App\Generated\Tasks\ListChannelsResult;
use App\Generated\Tasks\Symfony\SeampactOperation;
use Seampact\ConsumerSuite\SampleData;
use Seampact\ConsumerSuite\ScriptedAnswers;

final class ChannelsController implements ChannelsEndpoints
{
    #[SeampactOperation('getChannel')]
    public function getChannel(GetChannelInput $input): GetChannelResult
    {
        return ScriptedAnswers::answer('getChannel', 200, static fn (array $body): GetChannelResult => new GetChannelResponse200(SampleData::channelOf($body)))
            ?? new GetChannelResponse200(SampleData::loadedChannel($input->scopes()->channel(), $input->principal()->userId));
    }

    #[SeampactOperation('listChannels')]
    public function listChannels(ListChannelsInput $input): ListChannelsResult
    {
        return PagedLists::listChannels($input);
    }
}
