<?php

declare(strict_types=1);

namespace Seampact\ApiPlatform\Tests\Support;

/** A handler service with one marked method, as an app route could lead to it directly. */
final class MarkedHandler
{
    #[HandlerMark('getTask')]
    public function getTask(): void
    {
    }
}
