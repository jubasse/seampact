<?php

declare(strict_types=1);

namespace Seampact\Hooks\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Hooks\RequestView;
use Seampact\Hooks\SignatureEncoding;
use Seampact\Hooks\SignatureTemplate;
use Seampact\Hooks\SignedApplicationRequest;
use Seampact\Hooks\SignedTemplateRequest;
use Seampact\Hooks\StoredResponse;
use Seampact\Hooks\StoredResponse\Header;

// A debug dump of a value that may carry a secret prints a placeholder in its place.
final class RedactedDebugInfoTest extends TestCase
{
    private const SECRET = 'whsec_never_printed';

    private function dumpOf(object $value): string
    {
        return print_r($value, true);
    }

    public function testRedactsSecretsInDebugDumps(): void
    {
        $template = new SignatureTemplate('hmac-sha256', '{rawBody}', SignatureEncoding::Hex);
        $values = [
            new RequestView('POST', '/hooks', ['authorization' => [self::SECRET]], '10.0.0.1'),
            new SignedTemplateRequest(self::SECRET, [self::SECRET], 'github', $template, '1700000000'),
            new SignedApplicationRequest(self::SECRET, self::SECRET, ['x-signature' => self::SECRET]),
            new StoredResponse(201, [new Header('set-cookie', self::SECRET)], self::SECRET),
        ];

        foreach ($values as $value) {
            $dump = $this->dumpOf($value);

            self::assertStringNotContainsString(self::SECRET, $dump);
            self::assertStringContainsString('[redacted]', $dump);
        }
    }

    public function testKeepsTheValuesThatCarryNoSecret(): void
    {
        $dump = $this->dumpOf(new RequestView('POST', '/hooks', [], '10.0.0.1'));

        self::assertStringContainsString('/hooks', $dump);
        self::assertStringContainsString('10.0.0.1', $dump);
    }
}
