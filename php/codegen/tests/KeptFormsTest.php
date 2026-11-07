<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\FormArrival;
use Seampact\Codegen\KeptForms;
use Seampact\Codegen\Refusals;
use Seampact\Codegen\Tests\Support\FixedReleases;
use Seampact\Codegen\Tests\Support\ReferenceContract;
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

    public function testAScopeIdReadFromASourceOtherThanThePathIsRefusedByNameAtItsSource(): void
    {
        $sources = [
            (object) ['in' => 'query', 'name' => 'channelId'],
            (object) ['in' => 'header', 'name' => 'X-Channel-Id'],
            (object) ['in' => 'host'],
            (object) ['in' => 'subdomain'],
            (object) ['in' => 'principal', 'name' => 'userId'],
        ];

        foreach ($sources as $source) {
            $document = ReferenceIr::keeping(ReferenceIr::document(), ['getTask']);
            $operation = is_array($document->operations) ? $document->operations[0] : null;
            self::assertInstanceOf(\stdClass::class, $operation);
            $scopes = $operation->scopes;
            self::assertIsArray($scopes);
            $firstScope = $scopes[0];
            self::assertInstanceOf(\stdClass::class, $firstScope);
            $firstScope->source = $source;

            $refusals = new Refusals('server', 'test', 'seampact/test');
            new KeptForms(ReferenceIr::read($document), $refusals, new FixedReleases(null));

            try {
                $refusals->throwIfAny();
                self::fail("The scope source '{$source->in}' was not refused.");
            } catch (GenerationRefusedException $refused) {
                $scopeSourceProblems = array_values(array_filter($refused->problems, static fn ($problem): bool => str_starts_with($problem->code, 'scope.source')));

                self::assertCount(1, $scopeSourceProblems, "the scope source '{$source->in}'");
                self::assertSame('scope.source.unsupported', $scopeSourceProblems[0]->code);
                self::assertSame("entry 'server' /operations/0/scopes/0/source (operation 'getTask')", $scopeSourceProblems[0]->where);
            }
        }
    }

    // HAL's page names its `_embedded` member by `$collection` and links each item by `$itemSelf`, which the page reply
    // does not fill: the boundary would drop them, so the style is refused by name.
    public function testAPageBodyWritingSlotsThePageReplyDoesNotFillIsRefusedByName(): void
    {
        $document = ReferenceIr::keeping(ReferenceIr::document(), ['listTasks']);
        $halPages = self::member(self::member(ReferenceContract::document('tasks.ir.json', 'pack-hal'), 'pagings'), 'halPages');
        self::member(self::member(self::member($document, 'pagings'), 'cursor'), 'response')->body = self::member(self::member($halPages, 'response'), 'body');

        $messages = self::refused($document, null);

        self::assertStringContainsString("The page slots '\$collection', '\$itemSelf' of the paging style 'cursor'", $messages['paging.response.slot.unsupported'] ?? '');
    }

    // The page reply fills `$page` for a page-number style only: an offset style's page number has no declared base.
    public function testAPageNumberSlotUnderAnOffsetStyleIsRefusedByName(): void
    {
        $document = ReferenceContract::document('tasks.ir.json', 'pack-laravel');
        self::member(self::member($document, 'pagings'), 'laravelPages')->position = 'offset';

        $messages = self::refused($document, null);

        self::assertStringContainsString("The page slots '\$page' of the paging style 'laravelPages'", $messages['paging.response.slot.unsupported'] ?? '');
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

    public function testASignatureVerifiedByTheApplicationIsRefusedByNameOnEveryTarget(): void
    {
        $document = ReferenceIr::keeping(ReferenceIr::document(), ['payments']);
        $schemes = $document->schemes;
        self::assertInstanceOf(\stdClass::class, $schemes);
        $signatureScheme = $schemes->stripeSignature;
        self::assertInstanceOf(\stdClass::class, $signatureScheme);
        $signatureScheme->signature = (object) ['verify' => 'application', 'headers' => ['Stripe-Signature']];

        $messages = self::refused($document, null);

        self::assertArrayHasKey('signature.application.unsupported', $messages);
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

    public function testAQueryListOfScalarsOrEnumsIsKeptInEitherFormAndAListOfObjectsIsRefusedByName(): void
    {
        $document = ReferenceIr::keeping(ReferenceIr::document(), ['getTask']);
        $operation = is_array($document->operations) ? $document->operations[0] : null;
        self::assertInstanceOf(\stdClass::class, $operation);
        self::assertInstanceOf(\stdClass::class, $operation->params);
        $repeat = ['kind' => 'list', 'style' => 'form', 'explode' => true, 'brackets' => false];
        $comma = ['kind' => 'list', 'style' => 'form', 'explode' => false, 'brackets' => false];
        $operation->params->query = [
            self::queryParam('score', ['kind' => 'scalar', 'type' => 'integer', 'refinements' => new \stdClass()], $repeat),
            self::queryParam('state', ['kind' => 'enum', 'enum' => 'TaskState'], $comma),
        ];

        $refusals = new Refusals('server', 'test', 'seampact/test');
        new KeptForms(ReferenceIr::read($document), $refusals, new FixedReleases(null));
        self::assertTrue($refusals->isEmpty());

        $operation->params->query[] = self::queryParam('archives', ['kind' => 'ref', 'schema' => 'ArchiveTask'], $repeat);
        self::assertSame(['param.query.structured.unsupported'], array_keys(self::refused($document, null)));
    }

    public function testAQueryListInAStyleOtherThanFormIsRefusedByName(): void
    {
        $document = ReferenceIr::keeping(ReferenceIr::document(), ['getTask']);
        $operation = is_array($document->operations) ? $document->operations[0] : null;
        self::assertInstanceOf(\stdClass::class, $operation);
        self::assertInstanceOf(\stdClass::class, $operation->params);
        $spaceDelimited = ['kind' => 'list', 'style' => 'spaceDelimited', 'explode' => false, 'brackets' => false];
        $operation->params->query = [self::queryParam('tags', ['kind' => 'scalar', 'type' => 'integer', 'refinements' => new \stdClass()], $spaceDelimited)];

        self::assertSame(['param.query.structured.unsupported'], array_keys(self::refused($document, null)));
    }

    public function testTheRefusalNamesListsForAQueryParameterOnly(): void
    {
        $document = ReferenceIr::keeping(ReferenceIr::document(), ['getTask']);
        $operation = is_array($document->operations) ? $document->operations[0] : null;
        self::assertInstanceOf(\stdClass::class, $operation);
        self::assertInstanceOf(\stdClass::class, $operation->params);
        $items = ['kind' => 'scalar', 'type' => 'integer', 'refinements' => new \stdClass()];
        $operation->params->query = [self::queryParam('archives', ['kind' => 'ref', 'schema' => 'ArchiveTask'], ['kind' => 'list', 'style' => 'form', 'explode' => true, 'brackets' => false])];
        $operation->params->header = [self::queryParam('X-Scores', $items, ['kind' => 'list', 'style' => 'simple', 'explode' => false, 'brackets' => false])];

        $messages = self::refused($document, null);

        self::assertStringStartsWith('A query parameter that is not a scalar, an enum or a list of them in the form style', $messages['param.query.structured.unsupported']);
        self::assertStringStartsWith('A header parameter that is not a scalar or an enum is not', $messages['param.header.structured.unsupported']);
    }

    /**
     * @param array<string, mixed> $items
     * @param array<string, mixed> $wire
     */
    private static function queryParam(string $name, array $items, array $wire): \stdClass
    {
        $param = json_decode(json_encode(['name' => $name, 'required' => false, 'type' => ['kind' => 'array', 'items' => $items], 'wire' => $wire], JSON_THROW_ON_ERROR), false, 512, JSON_THROW_ON_ERROR);
        self::assertInstanceOf(\stdClass::class, $param);

        return $param;
    }

    private static function member(\stdClass $object, string $name): \stdClass
    {
        $member = $object->{$name} ?? null;
        self::assertInstanceOf(\stdClass::class, $member);

        return $member;
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
