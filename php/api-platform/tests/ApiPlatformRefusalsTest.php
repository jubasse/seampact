<?php

declare(strict_types=1);

namespace Seampact\ApiPlatform\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\ApiPlatform\ApiPlatformGenerator;
use Seampact\Codegen\Tests\Support\ReferenceContract;
use Seampact\Codegen\Tests\Support\ReferenceIr;
use Seampact\Codegen\Tests\Support\ResponseForms;
use Seampact\Ir\Run\GenerationRefusedException;

/** The forms 1.0 leaves out are refused by name through the API Platform generator (ADR 0024 "Refused by name or waiting"). */
final class ApiPlatformRefusalsTest extends TestCase
{
    public function testTheAccessFormsOneZeroLeavesOutAreRefusedByName(): void
    {
        $document = ReferenceContract::withOperation('getTask', static function (\stdClass $operation, \stdClass $document): void {
            $operation->upstream = ['billing'];
            $operation->principalRequires = [(object) ['field' => 'verified', 'origin' => (object) ['layer' => 'api', 'pointer' => '/principalRequires/0']]];
            $operation->bindings = [(object) [
                'from' => (object) ['in' => 'body', 'name' => 'ownerId'],
                'to' => (object) ['in' => 'principal', 'name' => 'profileId'],
                'origin' => (object) ['layer' => 'api', 'pointer' => '/bindings/0'],
            ]];
            self::firstOf($operation->scopes)->source = (object) ['in' => 'resolver'];
            self::object(self::object($document->identities)->user)->principal = (object) ['kind' => 'variants', 'variants' => (object) ['viewer' => 'UserPrincipal']];
            $schemes = self::object($document->schemes);
            $schemes->bearer = (object) ['id' => 'bearer', 'kind' => 'basic', 'origin' => self::object($schemes->bearer)->origin];
        });

        $refused = self::refused($document);

        foreach (['upstream', 'principalRequires', 'bindings', 'scope.source', 'principal.variants', 'scheme.basic'] as $form) {
            self::assertArrayHasKey("{$form}.unsupported", $refused);
        }
    }

    public function testAScopeIdReadFromAQueryIsRefusedByName(): void
    {
        $document = ReferenceContract::withOperation('getTask', static function (\stdClass $operation): void {
            self::firstOf($operation->scopes)->source = (object) ['in' => 'query', 'name' => 'channel'];
        });

        self::assertArrayHasKey('scope.source.unsupported', self::refused($document));
    }

    public function testASignatureVerifiedByTheApplicationIsRefusedByName(): void
    {
        $document = ReferenceIr::keeping(ReferenceIr::document(), ['payments']);
        self::object(self::object($document->schemes)->stripeSignature)->signature = (object) ['verify' => 'application', 'headers' => ['Stripe-Signature']];

        self::assertArrayHasKey('signature.application.unsupported', self::refused($document));
    }

    public function testAQueryApiKeySchemeIsRefusedByName(): void
    {
        $document = ReferenceIr::keeping(ReferenceIr::document(), ['getTask']);
        $schemes = self::object($document->schemes);
        $schemes->bearer = (object) ['id' => 'bearer', 'kind' => 'query', 'name' => 'api_key', 'origin' => self::object($schemes->bearer)->origin];

        self::assertArrayHasKey('scheme.query.unsupported', self::refused($document));
    }

    public function testAPageBodyWritingSlotsThePageReplyDoesNotFillIsRefusedByName(): void
    {
        $document = ReferenceIr::keeping(ReferenceIr::document(), ['listTasks']);
        $halPages = self::object(self::object(ReferenceContract::document('tasks.ir.json', 'pack-hal'))->pagings)->halPages;
        self::object(self::object(self::object($document->pagings)->cursor)->response)->body = self::object(self::object($halPages)->response)->body;

        self::assertArrayHasKey('paging.response.slot.unsupported', self::refused($document));
    }

    public function testASortKeyRestrictedByARightIsRefusedByName(): void
    {
        $document = ReferenceContract::withOperation('listTasks', static function (\stdClass $operation): void {
            self::firstOf(self::object($operation->paging)->sortKeys)->right = 'tasks.seeEffort';
        });

        self::assertArrayHasKey('paging.sortKey.right.unsupported', self::refused($document));
    }

    public function testAnInputFieldRightBelowTheTopLevelIsRefusedByName(): void
    {
        $document = ReferenceContract::withOperation('createTask', static function (\stdClass $operation): void {
            self::firstOf($operation->fieldRights)->pointer = '/details/effort';
        });

        self::assertArrayHasKey('fieldRight.nestedPointer.unsupported', self::refused($document));
    }

    public function testAResponseHeaderTheRouteWritesIsRefusedByName(): void
    {
        self::assertArrayHasKey('response.header.unsupported', self::refused(ResponseForms::withRouteWrittenHeader()));
    }

    public function testAUnionIsRefusedByName(): void
    {
        self::assertArrayHasKey('schema.union.unsupported', self::refused(ResponseForms::withUnionAnswer()));
    }

    public function testADegradableOperationIsRefusedByName(): void
    {
        self::assertArrayHasKey('degradable.unsupported', self::refused(ResponseForms::withDegradableOperation()));
    }

    public function testARedirectResponseIsRefusedByName(): void
    {
        self::assertStringContainsString("'redirect' response", self::refused(ResponseForms::withRedirectAnswer())['response.shape.unsupported'] ?? '');
    }

    public function testAFormBodyIsRefusedByName(): void
    {
        $document = ReferenceContract::document(ReferenceContract::TASKS);
        self::bodyOf($document, 'createTask')->media = 'application/x-www-form-urlencoded';

        self::assertArrayHasKey('input.form.unsupported', self::refused($document));
    }

    public function testAMultipartBodyIsRefusedByName(): void
    {
        $document = ReferenceContract::document(ReferenceContract::TASKS);
        self::bodyOf($document, 'createTask')->media = 'multipart/form-data';

        self::assertArrayHasKey('input.multipart.unsupported', self::refused($document));
    }

    public function testAFileDownloadIsRefusedByName(): void
    {
        $document = ReferenceContract::document(ReferenceContract::TASKS);
        $responses = self::operationOf($document, 'getTask')->responses;
        self::assertIsArray($responses);
        $download = self::object($responses[0]);
        $download->shape = 'binary';
        $download->media = 'application/pdf';
        unset($download->body);

        self::assertArrayHasKey('response.shape.unsupported', self::refused($document));
    }

    public function testAQueryListInBracketsFormIsRefusedByName(): void
    {
        $document = ReferenceContract::document(ReferenceContract::TASKS);
        $wire = self::listWireOf($document, 'listTasks');
        $wire->explode = true;
        $wire->brackets = true;

        self::assertArrayHasKey('query.list.brackets.unsupported', self::refused($document));
    }

    public function testNativeAccessIsRefusedByName(): void
    {
        $refused = self::refused(ReferenceContract::document(ReferenceContract::TASKS), ['accessHooks' => false]);

        self::assertSame(['artefacts.accessHooks.unsupported'], array_keys($refused));
    }

    public function testTheCompletePageFactOfAChangesFeedIsRefusedByName(): void
    {
        $document = ReferenceContract::document('tasksPaging.ir.json');

        self::assertArrayHasKey('paging.handlerResult.unsupported', self::refused($document));
    }

    private static function operationOf(\stdClass $document, string $operationId): \stdClass
    {
        self::assertIsArray($document->operations);
        foreach ($document->operations as $operation) {
            if ($operation instanceof \stdClass && $operation->id === $operationId) {
                return $operation;
            }
        }

        self::fail("The reference tasks api has no operation '{$operationId}'.");
    }

    private static function bodyOf(\stdClass $document, string $operationId): \stdClass
    {
        $input = self::operationOf($document, $operationId)->input ?? null;
        self::assertInstanceOf(\stdClass::class, $input);

        return $input;
    }

    private static function listWireOf(\stdClass $document, string $operationId): \stdClass
    {
        $params = self::operationOf($document, $operationId)->params;
        self::assertInstanceOf(\stdClass::class, $params);
        self::assertIsArray($params->query);
        foreach ($params->query as $param) {
            $wire = $param instanceof \stdClass ? $param->wire ?? null : null;
            if ($wire instanceof \stdClass && $wire->kind === 'list') {
                return $wire;
            }
        }

        self::fail("The reference tasks api has no list query param on '{$operationId}'.");
    }

    private static function object(mixed $value): \stdClass
    {
        self::assertInstanceOf(\stdClass::class, $value);

        return $value;
    }

    private static function firstOf(mixed $list): \stdClass
    {
        self::assertIsArray($list);

        return self::object($list[0] ?? null);
    }

    /**
     * Each refusal code and the message of its first place.
     *
     * @param array<string, mixed> $artefacts
     * @return array<string, string>
     */
    private static function refused(\stdClass $document, array $artefacts = []): array
    {
        $generator = new ApiPlatformGenerator();

        try {
            $generator->generate(ReferenceContract::read($generator, $document), ReferenceContract::entry(ApiPlatformGenerator::PACKAGE, 'tasks', 'App\\Tasks', [], $artefacts));
        } catch (GenerationRefusedException $refused) {
            $messages = [];
            foreach ($refused->problems as $problem) {
                $messages[$problem->code] ??= $problem->message;
            }

            return $messages;
        }

        self::fail('The contract was generated, but a form in it should be refused.');
    }
}
