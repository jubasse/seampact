<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Illuminate\Container\Container;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\ApiContract;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\AuthenticateCall;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\BoundaryState;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\DumpRedaction;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\Hooks;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\SignatureHeader;
use Seampact\Golden\TasksConsistent\Laravel\TasksContract;
use Seampact\Golden\TasksConsistent\Laravel\UserCredentials;
use Seampact\Golden\TasksConsistent\PaymentsInput;
use Seampact\Golden\TasksConsistent\Schemas\CreateTask;
use Seampact\Golden\TasksConsistent\Schemas\PaymentEvent;
use Seampact\Hooks\OperationRef;
use Seampact\Hooks\RequestView;
use Seampact\Hooks\SignatureEncoding;
use Seampact\Hooks\SignatureTemplate;
use Seampact\Hooks\SignedTemplateRequest;
use Symfony\Component\VarDumper\Cloner\VarCloner;
use Symfony\Component\VarDumper\Dumper\CliDumper;

/**
 * One generated class of each kind ADR 0023 "Redaction" lists, holding a known secret: `var_dump`, `print_r` and the
 * provider's VarDumper caster never show it, and print `[redacted]` in its place.
 */
final class RedactionTest extends TestCase
{
    private const SECRET = 'seampact-known-secret';
    private const REDACTED = '[redacted]';

    /** @return iterable<string, array{object}> */
    public static function holders(): iterable
    {
        yield 'a sensitive member' => [new CreateTask(self::SECRET, null)];
        yield 'a signed route\'s parsed body' => [new PaymentsInput(new PaymentEvent(self::SECRET, 'invoice.paid', null))];
        yield 'an identity\'s credentials' => [new UserCredentials(self::SECRET, self::SECRET)];
        yield 'the credentials, CSRF token and signed request a hook receives' => [new AuthenticateCall(
            'user',
            new UserCredentials(self::SECRET, null),
            self::SECRET,
            new RequestView('POST', '/v1/hooks/payments', []),
            new OperationRef('tasks', 'payments'),
            new SignedTemplateRequest(self::SECRET, [self::SECRET], 'stripe', new SignatureTemplate('hmac-sha256', '{ts}.{rawBody}', SignatureEncoding::Hex, 300000), '1'),
        )];
        yield 'a parsed signature header' => [SignatureHeader::parse('t={ts},v1={sig}', 't=1,v1=' . self::SECRET) ?? new \stdClass()];
        yield 'the boundary state\'s raw and decoded body' => [self::stateHoldingTheSecret()];
    }

    #[DataProvider('holders')]
    public function testVarDumpShowsNoSecret(object $holder): void
    {
        ob_start();
        var_dump($holder);
        self::assertRedacted((string) ob_get_clean());
    }

    #[DataProvider('holders')]
    public function testPrintRShowsNoSecret(object $holder): void
    {
        self::assertRedacted(print_r($holder, true));
    }

    #[DataProvider('holders')]
    public function testTheVarDumperCasterShowsNoSecret(object $holder): void
    {
        DumpRedaction::register(ApiContract::of(TasksContract::class));

        $dumped = (new CliDumper())->dump((new VarCloner())->cloneVar($holder), true);

        self::assertRedacted((string) $dumped);
    }

    private static function assertRedacted(string $dumped): void
    {
        self::assertStringNotContainsString(self::SECRET, $dumped);
        self::assertStringContainsString(self::REDACTED, $dumped);
    }

    private static function stateHoldingTheSecret(): BoundaryState
    {
        $state = new BoundaryState(ApiContract::of(TasksContract::class), 'payments', [], new RequestView('POST', '/v1/hooks/payments', []), new Hooks(new Container()));
        $state->rawBody = self::SECRET;
        $state->body = (object) ['id' => self::SECRET];

        return $state;
    }
}
