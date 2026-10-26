<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;
use Seampact\Golden\TasksConsistent\PaymentsInput;
use Seampact\Golden\TasksConsistent\Schemas\CreateTask;
use Seampact\Golden\TasksConsistent\Schemas\PaymentEvent;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\ApiContract;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\AuthenticateCall;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\BoundaryState;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\Hooks;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\SignatureHeader;
use Seampact\Golden\TasksConsistent\Symfony\TasksContract;
use Seampact\Golden\TasksConsistent\Symfony\TasksSeampactBundle;
use Seampact\Golden\TasksConsistent\Symfony\UserCredentials;
use Seampact\Hooks\OperationRef;
use Seampact\Hooks\RequestView;
use Seampact\Hooks\SignatureEncoding;
use Seampact\Hooks\SignatureTemplate;
use Seampact\Hooks\SignedTemplateRequest;
use Symfony\Component\DependencyInjection\Container;
use Symfony\Component\DependencyInjection\ServiceLocator;
use Symfony\Component\VarDumper\Cloner\AbstractCloner;
use Symfony\Component\VarDumper\Cloner\VarCloner;
use Symfony\Component\VarDumper\Dumper\CliDumper;

/**
 * One generated class of each kind ADR 0024 "Redaction" lists, holding a known secret: `var_dump`, `print_r` and the
 * VarDumper caster the api's bundle registers on boot never show it, and print `[redacted]` in its place.
 */
final class RedactionTest extends TestCase
{
    private const SECRET = 'seampact-known-secret';
    private const REDACTED = '[redacted]';

    /** @var array<mixed> */
    private array $defaultCasters = [];

    protected function setUp(): void
    {
        $this->defaultCasters = AbstractCloner::$defaultCasters;
    }

    protected function tearDown(): void
    {
        AbstractCloner::$defaultCasters = $this->defaultCasters;
    }

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
    public function testVarDumperShowsNoSecretOnceTheBundleBooted(object $holder): void
    {
        self::assertStringContainsString(self::SECRET, self::dumped($holder), 'VarDumper reads properties, so without the caster it prints the secret.');

        $bundle = new TasksSeampactBundle();
        $bundle->setContainer(new Container());
        $bundle->boot();

        self::assertRedacted(self::dumped($holder));
    }

    private static function dumped(object $holder): string
    {
        $output = (new CliDumper())->dump((new VarCloner())->cloneVar($holder), true);

        return is_string($output) ? $output : '';
    }

    private static function assertRedacted(string $dumped): void
    {
        self::assertStringNotContainsString(self::SECRET, $dumped);
        self::assertStringContainsString(self::REDACTED, $dumped);
    }

    private static function stateHoldingTheSecret(): BoundaryState
    {
        $hooks = new Hooks(new ServiceLocator([]), [], [], null, new NullLogger());
        $state = new BoundaryState(ApiContract::of(TasksContract::class), 'payments', [], new RequestView('POST', '/v1/hooks/payments', []), $hooks);
        $state->rawBody = self::SECRET;
        $state->body = (object) ['id' => self::SECRET];

        return $state;
    }
}
