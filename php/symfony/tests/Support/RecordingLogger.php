<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests\Support;

use Psr\Log\AbstractLogger;

/** A logger that keeps its lines. */
final class RecordingLogger extends AbstractLogger
{
    /** @var list<string> */
    public array $lines = [];

    public function log(mixed $level, string|\Stringable $message, array $context = []): void
    {
        $this->lines[] = (string) $message;
    }
}
