<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Tests\Support\ReferenceContract;
use Seampact\Ir\Run\GenerationRefusedException;
use Seampact\Symfony\SymfonyGenerator;

/** The body forms 1.0 refuses by name (CHK-150, 151, 152): a form or multipart body and a file download. */
final class BodyFormsRefusalsTest extends TestCase
{
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
        $download = $responses[0];
        self::assertInstanceOf(\stdClass::class, $download);
        $download->shape = 'binary';
        $download->media = 'application/pdf';
        unset($download->body);

        self::assertArrayHasKey('response.shape.unsupported', self::refused($document));
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

    /** @return array<string, string> each refused code with its first message */
    private static function refused(\stdClass $document): array
    {
        $generator = new SymfonyGenerator();

        try {
            $generator->generate(ReferenceContract::read($generator, $document), ReferenceContract::entry(SymfonyGenerator::PACKAGE, 'tasks', 'App\\Tasks'));
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
