<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Seampact\Golden\TasksConsistent\Schemas\PaymentEvent;

/**
 * The input of operation 'payments', as its handler reads it.
 */
final readonly class PaymentsInput
{
    private const REDACTED = '[redacted]';

    public function __construct(
        #[\SensitiveParameter]
        public PaymentEvent $body,
    ) {
    }

    /**
     * @return array<string, mixed> each sensitive member redacted, so a dump never shows it
     */
    public function __debugInfo(): array
    {
        return [
            'body' => self::REDACTED,
        ];
    }
}
