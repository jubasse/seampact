<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Illuminate\Config\Repository;
use Illuminate\Container\Container;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Providers\FoundationServiceProvider;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\AuthenticateCall;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\DumpRedaction;
use Seampact\Codegen\Runtime\SignatureHeader;
use Seampact\Codegen\Tests\Support\ReferenceContract;
use Seampact\Golden\TasksConsistent\GetChannelRequest;
use Seampact\Golden\TasksConsistent\Laravel\TasksContract;
use Seampact\Golden\TasksConsistent\Laravel\UserPrincipal;
use Seampact\Golden\TasksConsistent\Laravel\UserCredentials;
use Seampact\Golden\TasksConsistent\PaymentsInput;
use Seampact\Golden\TasksConsistent\Schemas\CreateTask;
use Seampact\Golden\TasksConsistent\Schemas\PaymentEvent;
use Seampact\Hooks\OperationRef;
use Seampact\Hooks\RequestView;
use Seampact\Hooks\ResolvedScope;
use Seampact\Hooks\SignatureEncoding;
use Seampact\Hooks\SignatureTemplate;
use Seampact\Hooks\SignedTemplateRequest;
use Seampact\Laravel\LaravelGenerator;
use Seampact\Laravel\Runtime\Hooks;
use Seampact\Laravel\Runtime\RedactingDumper;
use Symfony\Component\VarDumper\Cloner\VarCloner;
use Symfony\Component\VarDumper\Dumper\CliDumper;
use Symfony\Component\VarDumper\VarDumper;

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
        yield 'a FormRequest\'s principal and scopes' => [self::formRequestHoldingTheSecret()];
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

    public function testLaravelsDumpShowsNoSecretOnceTheProviderInstalledTheCasters(): void
    {
        $previousFormat = $_SERVER['VAR_DUMPER_FORMAT'] ?? null;
        $_SERVER['VAR_DUMPER_FORMAT'] = 'html';
        $app = new Application(sys_get_temp_dir());
        $app->instance('config', new Repository(['view' => ['compiled' => sys_get_temp_dir()]]));
        $app->register(FoundationServiceProvider::class);

        RedactingDumper::install($app, ApiContract::of(TasksContract::class));
        ob_start();
        dump(new UserCredentials(self::SECRET, self::SECRET));
        $dumped = (string) ob_get_clean();

        if ($previousFormat === null) {
            unset($_SERVER['VAR_DUMPER_FORMAT']);
        } else {
            $_SERVER['VAR_DUMPER_FORMAT'] = $previousFormat;
        }
        VarDumper::setHandler(null);
        self::assertRedacted($dumped);
    }

    public function testADumpHandlerInstalledEarlierIsKept(): void
    {
        $app = new Application(sys_get_temp_dir());
        $app->instance('config', new Repository(['view' => ['compiled' => sys_get_temp_dir()]]));
        $app->register(FoundationServiceProvider::class);
        $received = [];
        VarDumper::setHandler(static function (mixed $value) use (&$received): void {
            $received[] = $value;
        });

        RedactingDumper::install($app, ApiContract::of(TasksContract::class));
        VarDumper::dump('marker');
        VarDumper::setHandler(null);

        self::assertSame(['marker'], $received);
    }

    private static function assertRedacted(string $dumped): void
    {
        self::assertStringNotContainsString(self::SECRET, $dumped);
        self::assertStringContainsString(self::REDACTED, $dumped);
    }

    public function testASensitivePrincipalMemberIsRedactedInThePrincipalsDump(): void
    {
        $document = ReferenceContract::document(ReferenceContract::TASKS);
        $schemas = $document->schemas instanceof \stdClass ? $document->schemas : new \stdClass();
        $principal = $schemas->UserPrincipal instanceof \stdClass ? $schemas->UserPrincipal : new \stdClass();
        $properties = is_array($principal->properties) ? $principal->properties : [];
        $email = json_decode(json_encode($properties[0], JSON_THROW_ON_ERROR), false, 512, JSON_THROW_ON_ERROR);
        self::assertInstanceOf(\stdClass::class, $email);
        $email->name = 'email';
        $email->sensitive = true;
        $email->type = (object) ['kind' => 'scalar', 'type' => 'string', 'refinements' => new \stdClass()];
        $principal->properties = [...$properties, $email];

        $namespace = 'App\\SensitivePrincipal';
        $files = (new LaravelGenerator())->generate(ReferenceContract::read(new LaravelGenerator(), ReferenceContract::kept($document, ['getTask'])), ReferenceContract::entry(LaravelGenerator::PACKAGE, 'tasks', $namespace));
        foreach (['Laravel/UserPrincipalMembers.php', 'Laravel/UserPrincipal.php'] as $suffix) {
            $contents = array_values(array_filter($files, static fn (object $file): bool => str_ends_with($file->path, $suffix)))[0]->contents ?? self::fail("No generated {$suffix}.");
            eval(substr($contents, strlen('<?php')));
        }
        $class = $namespace . '\\Laravel\\UserPrincipal';
        $dumped = print_r(new $class(userId: 'alice', email: self::SECRET), true);

        self::assertStringContainsString('alice', $dumped);
        self::assertRedacted($dumped);
    }

    private static function formRequestHoldingTheSecret(): GetChannelRequest
    {
        $state = new BoundaryState(ApiContract::of(TasksContract::class), 'getChannel', [], new RequestView('GET', '/v1/channels/1', []), new Hooks(new Container()));
        $state->principal = new UserPrincipal(self::SECRET);
        $state->scopes = [new ResolvedScope('channel', '1', (object) ['name' => self::SECRET])];
        $state->admitted = true;
        $request = GetChannelRequest::create('/v1/channels/1');
        $request->attributes->set(BoundaryState::attributeName('tasks'), $state);

        return $request;
    }

    private static function stateHoldingTheSecret(): BoundaryState
    {
        $state = new BoundaryState(ApiContract::of(TasksContract::class), 'payments', [], new RequestView('POST', '/v1/hooks/payments', []), new Hooks(new Container()));
        $state->rawBody = self::SECRET;
        $state->body = (object) ['id' => self::SECRET];

        return $state;
    }
}
