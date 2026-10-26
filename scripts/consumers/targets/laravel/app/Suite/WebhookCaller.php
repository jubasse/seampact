<?php

declare(strict_types=1);

namespace App\Suite;

/** The principal the `stripe` identity's hook authenticates: the account that signed the webhook. */
final readonly class WebhookCaller
{
    public function __construct(public string $account)
    {
    }
}
