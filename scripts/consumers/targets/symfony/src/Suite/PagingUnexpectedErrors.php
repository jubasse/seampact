<?php

declare(strict_types=1);

namespace App\Suite;

use App\Generated\TasksPaging\Symfony\UnexpectedErrorListener as PagingUnexpectedErrorListener;
use App\Generated\TasksSplitSort\Symfony\UnexpectedErrorListener as SplitSortUnexpectedErrorListener;
use Psr\Log\LoggerInterface;
use Seampact\Codegen\Runtime\UnexpectedFailure;

/** Logs each unexpected failure of the paging apis as an app's error reporter would; the log-lines route captures the line. */
final class PagingUnexpectedErrors implements PagingUnexpectedErrorListener, SplitSortUnexpectedErrorListener
{
    public function __construct(private readonly LoggerInterface $logger)
    {
    }

    public function onUnexpectedError(UnexpectedFailure $failure): void
    {
        $why = $failure->cause?->getMessage() ?? $failure->reason;
        $this->logger->error("unexpected failure in {$failure->api}." . ($failure->operation ?? '(none)') . ": {$why}");
    }
}
