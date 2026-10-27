<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Generated\Tasks\ChannelsEndpoints;
use App\Generated\Tasks\GetChannelResponse200;
use App\Generated\Tasks\GetChannelResult;
use App\Generated\Tasks\GetChannelRequest;
use App\Generated\Tasks\ListChannelsRequest;
use App\Generated\Tasks\ListChannelsResult;
use Seampact\ConsumerSuite\SampleData;
use Seampact\ConsumerSuite\ScriptedAnswers;

final class ChannelsController implements ChannelsEndpoints
{
    public function getChannel(GetChannelRequest $request): GetChannelResult
    {
        return ScriptedAnswers::answer('getChannel', 200, static fn (array $body): GetChannelResult => new GetChannelResponse200(SampleData::channelOf($body)))
            ?? new GetChannelResponse200(SampleData::loadedChannel($request->scopes()->channel(), $request->principal()->userId));
    }

    public function listChannels(ListChannelsRequest $request): ListChannelsResult
    {
        return PagedLists::listChannels($request);
    }
}
