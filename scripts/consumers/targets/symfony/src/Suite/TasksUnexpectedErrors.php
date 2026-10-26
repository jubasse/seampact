<?php

declare(strict_types=1);

namespace App\Suite;

use App\Generated\Tasks\Symfony\Runtime\UnexpectedErrorListener;
use App\Generated\Tasks\Symfony\Runtime\UnexpectedFailure;
use App\Generated\TasksService\Symfony\Runtime\UnexpectedErrorListener as ServiceUnexpectedErrorListener;
use App\Generated\TasksService\Symfony\Runtime\UnexpectedFailure as ServiceUnexpectedFailure;
use Psr\Log\LoggerInterface;

/** Logs each unexpected failure of either api as an app's error reporter would; the log-lines route captures the line. */
final class TasksUnexpectedErrors implements UnexpectedErrorListener, ServiceUnexpectedErrorListener
{
    public function __construct(private readonly LoggerInterface $logger)
    {
    }

    public function onUnexpectedError(UnexpectedFailure|ServiceUnexpectedFailure $failure): void
    {
        $why = $failure->cause?->getMessage() ?? $failure->reason;
        $this->logger->error("unexpected failure in {$failure->api}." . ($failure->operation ?? '(none)') . ": {$why}");
    }
}
