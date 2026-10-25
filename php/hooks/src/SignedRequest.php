<?php

declare(strict_types=1);

namespace Seampact\Hooks;

/**
 * What a signed identity's authenticate hook receives about the signature: a template scheme or an application one.
 * Only SignedTemplateRequest and SignedApplicationRequest implement it.
 */
interface SignedRequest
{
}
