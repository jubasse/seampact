<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\FormArrival;
use Seampact\Codegen\KeptForms;
use Seampact\Codegen\Refusals;
use Seampact\Codegen\Tests\Support\FixedReleases;
use Seampact\Codegen\Tests\Support\ReferenceIr;
use Seampact\Ir\Run\GenerationRefusedException;

final class KeptFormsTest extends TestCase
{
    public function testAPendingFormTheTargetGeneratesIsNotRefused(): void
    {
        $refusals = new Refusals('server', 'test', 'seampact/test');
        $kept = new KeptForms(ReferenceIr::read(ReferenceIr::keeping(ReferenceIr::document(), ['listChannels'])), $refusals, new FixedReleases(null));

        self::assertTrue($refusals->isEmpty());
        self::assertCount(1, $kept->operations());
    }

    public function testAPendingFormIsRefusedWithTheReleaseTheTargetNames(): void
    {
        $messages = self::refused(ReferenceIr::keeping(ReferenceIr::document(), ['listChannels']), FormArrival::inRelease('symfony-2'));

        self::assertStringContainsString('symfony-2 generates it', $messages['paging.unsupported'] ?? '');
        self::assertStringContainsString('symfony-2 generates it', $messages['response.shape.unsupported'] ?? '');
    }

    public function testAFormAbsentFromTheReferenceWaitsForAConsumerAfterOneZeroOnEveryTarget(): void
    {
        $document = ReferenceIr::keeping(ReferenceIr::document(), ['getTask']);
        $operation = is_array($document->operations) ? $document->operations[0] : null;
        self::assertInstanceOf(\stdClass::class, $operation);
        $operation->upstream = ['billing'];
        $operation->principalRequires = [(object) ['field' => 'verified', 'origin' => (object) ['layer' => 'api', 'pointer' => '/principalRequires/0']]];

        $messages = self::refused($document, null);

        self::assertStringContainsString('waits for a consumer after 1.0', $messages['upstream.unsupported'] ?? '');
        self::assertArrayHasKey('principalRequires.unsupported', $messages);
    }

    public function testAccessFormsThatOneZeroRefusesAreRefusedByNameOnEveryTarget(): void
    {
        $document = ReferenceIr::keeping(ReferenceIr::document(), ['getTask']);
        $operation = is_array($document->operations) ? $document->operations[0] : null;
        self::assertInstanceOf(\stdClass::class, $operation);
        $operation->bindings = [(object) [
            'from' => (object) ['in' => 'body', 'name' => 'ownerId'],
            'to' => (object) ['in' => 'principal', 'name' => 'profileId'],
            'origin' => (object) ['layer' => 'api', 'pointer' => '/bindings/0'],
        ]];
        $scopes = $operation->scopes;
        self::assertIsArray($scopes);
        $firstScope = $scopes[0];
        self::assertInstanceOf(\stdClass::class, $firstScope);
        $firstScope->source = (object) ['in' => 'resolver'];
        $identities = $document->identities;
        self::assertInstanceOf(\stdClass::class, $identities);
        $userIdentity = $identities->user;
        self::assertInstanceOf(\stdClass::class, $userIdentity);
        $userIdentity->principal = (object) ['kind' => 'variants', 'variants' => (object) ['viewer' => 'UserPrincipal']];

        $messages = self::refused($document, null);

        self::assertArrayHasKey('bindings.unsupported', $messages);
        self::assertArrayHasKey('scope.source.unsupported', $messages);
        self::assertArrayHasKey('principal.variants.unsupported', $messages);
    }

    /** @return iterable<string, array{array<string, string>, string}> */
    public static function credentialSchemesNoBoundaryReads(): iterable
    {
        yield 'query' => [['kind' => 'query', 'name' => 'api_key'], 'scheme.query.unsupported'];
        yield 'basic' => [['kind' => 'basic'], 'scheme.basic.unsupported'];
    }

    /** @param array<string, string> $scheme */
    #[DataProvider('credentialSchemesNoBoundaryReads')]
    public function testAQueryOrBasicCredentialSchemeIsRefusedByName(array $scheme, string $code): void
    {
        $document = ReferenceIr::keeping(ReferenceIr::document(), ['getTask']);
        $schemes = $document->schemes;
        self::assertInstanceOf(\stdClass::class, $schemes);
        self::assertInstanceOf(\stdClass::class, $schemes->bearer);
        $schemes->bearer = (object) ['id' => 'bearer', ...$scheme, 'origin' => $schemes->bearer->origin];

        $messages = self::refused($document, null);

        self::assertSame([$code], array_keys($messages));
        self::assertStringContainsString("A '{$scheme['kind']}' credential scheme", $messages[$code]);
    }

    public function testTheSchemasEnumsAndErrorsOfTheKeptOperationsAreCollected(): void
    {
        $refusals = new Refusals('server', 'test', 'seampact/test');
        $kept = new KeptForms(ReferenceIr::read(ReferenceIr::keeping(ReferenceIr::document(), ['getTask'])), $refusals, new FixedReleases(null));

        self::assertArrayHasKey('Task', $kept->objects());
        self::assertArrayHasKey('TaskState', $kept->enums());
        self::assertNotSame([], $kept->errors());
        self::assertSame(array_keys($kept->objects()), array_values(array_unique(array_keys($kept->objects()))));
    }

    public function testTheParamsSchemaOfEveryAskedRightAndRuleIsCollected(): void
    {
        $refusals = new Refusals('server', 'test', 'seampact/test');
        $kept = new KeptForms(ReferenceIr::read(ReferenceIr::keeping(ReferenceIr::document(), ['assignTask', 'purgeTask'])), $refusals, new FixedReleases(null));

        self::assertArrayHasKey('RolesParams', $kept->objects());
        self::assertArrayHasKey('RecentAuthParams', $kept->objects());
    }

    public function testTheExtensionValuesOfAnAskedRightRuleOrScopeAreRefusedOnceByName(): void
    {
        $document = ReferenceIr::keeping(ReferenceIr::document(), ['assignTask', 'createTask']);
        foreach ([['rights', 'roles'], ['rules', 'throttle'], ['scopes', 'channel']] as [$member, $name]) {
            $declarations = $document->{$member};
            self::assertInstanceOf(\stdClass::class, $declarations);
            self::assertInstanceOf(\stdClass::class, $declarations->{$name});
            $declarations->{$name}->extensions = (object) ['acme' => (object) ['audit' => $name]];
        }

        $refusals = new Refusals('server', 'test', 'seampact/test');
        new KeptForms(ReferenceIr::read($document), $refusals, new FixedReleases(null));

        $extensionRefusals = [];
        try {
            $refusals->throwIfAny();
        } catch (GenerationRefusedException $refused) {
            foreach ($refused->problems as $problem) {
                if (str_ends_with($problem->code, '.extensions.unsupported')) {
                    $extensionRefusals[] = [$problem->code, $problem->message];
                }
            }
        }
        usort($extensionRefusals, static fn (array $left, array $right): int => strcmp($left[0], $right[0]));

        self::assertSame(['right.extensions.unsupported', 'rule.extensions.unsupported', 'scope.extensions.unsupported'], array_column($extensionRefusals, 0));
        self::assertStringContainsString("An extension value of the right 'roles'", $extensionRefusals[0][1] ?? '');
        self::assertStringContainsString("An extension value of the rule 'throttle'", $extensionRefusals[1][1] ?? '');
        self::assertStringContainsString("An extension value of the scope 'channel'", $extensionRefusals[2][1] ?? '');
    }

    public function testTheCredentialHeadersNeverReachTheHandler(): void
    {
        $ir = ReferenceIr::read(ReferenceIr::keeping(ReferenceIr::document(), ['getTasksBatch']));

        self::assertNotSame([], $ir->operations[0]->params->header);
        self::assertSame([], KeptForms::handlerHeaders($ir->operations[0]));
    }

    /** @return array<string, string> each refusal code and its first message */
    private static function refused(\stdClass $document, ?FormArrival $arrival): array
    {
        $refusals = new Refusals('server', 'test', 'seampact/test');
        new KeptForms(ReferenceIr::read($document), $refusals, new FixedReleases($arrival));

        try {
            $refusals->throwIfAny();
        } catch (GenerationRefusedException $refused) {
            $messages = [];
            foreach ($refused->problems as $problem) {
                $messages[$problem->code] ??= $problem->message;
            }

            return $messages;
        }

        self::fail('Nothing was refused.');
    }
}
