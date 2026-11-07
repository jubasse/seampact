<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony;

/**
 * The credentials a request presents for identity 'stripe', one per scheme, null when absent.
 */
final readonly class StripeCredentials
{
  private const REDACTED = '[redacted]';

  public function __construct(
    public ?string $stripeSignature,
  ) {
  }

  /**
   * @return array<string, ?string> each credential redacted, so a dump never shows it
   */
  public function __debugInfo(): array
  {
    return [
      'stripeSignature' => $this->stripeSignature === null ? null : self::REDACTED,
    ];
  }
}
