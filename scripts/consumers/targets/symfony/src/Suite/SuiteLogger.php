<?php

declare(strict_types=1);

namespace App\Suite;

use Psr\Log\AbstractLogger;

/** The app's logger: each line goes to the suite's log-lines route, as an app's log handler would write it. */
final class SuiteLogger extends AbstractLogger
{
    /** @param array<mixed> $context */
    public function log($level, string|\Stringable $message, array $context = []): void
    {
        SuiteControl::writeLogLine((string) $message);
    }
}
