<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Seampact\Golden\TasksConsistent\Schemas\PaymentEvent;

/**
 * The input of operation 'payments', as its handler reads it.
 */
final readonly class PaymentsInput
{
    public function __construct(
        public PaymentEvent $body,
    ) {
    }
}
