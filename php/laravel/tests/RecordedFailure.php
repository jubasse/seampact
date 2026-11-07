<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Illuminate\Translation\ArrayLoader;
use Illuminate\Translation\PotentiallyTranslatedString;
use Illuminate\Translation\Translator;

/** The `$fail` callback of a validation rule, remembering whether the rule called it. */
final class RecordedFailure
{
    public bool $called = false;

    /** @return \Closure(string, string|null=): PotentiallyTranslatedString */
    public function callback(): \Closure
    {
        return function (string $message, ?string $attribute = null): PotentiallyTranslatedString {
            $this->called = true;

            return new PotentiallyTranslatedString($message, new Translator(new ArrayLoader(), 'en'));
        };
    }
}
