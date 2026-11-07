<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Golden;

use PHPUnit\Framework\TestCase;
use Seampact\Ir\Model\SourceMap;
use Seampact\Ir\Read\IrReader;
use Seampact\Ir\Read\IrSupport;
use Seampact\Ir\Tests\Support\Documents;

// The model reads every golden IR and side table and writes it back equal up to member order. The files are
// found by walking `fixtures/golden`, so a case another lane adds is read without a change here.
final class GoldenReadTest extends TestCase
{
    /** @return list<string> */
    private function goldenFilesEnding(string $suffix): array
    {
        $files = [];
        $walk = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator(Documents::repositoryRoot() . '/fixtures/golden', \FilesystemIterator::SKIP_DOTS),
        );
        foreach ($walk as $file) {
            if ($file instanceof \SplFileInfo && str_ends_with($file->getFilename(), $suffix)) {
                $files[] = $file->getPathname();
            }
        }
        sort($files);

        return $files;
    }

    private function text(string $file): string
    {
        $text = file_get_contents($file);
        self::assertIsString($text, $file);

        return $text;
    }

    private function document(string $file): \stdClass
    {
        $document = json_decode($this->text($file), false, 512, JSON_THROW_ON_ERROR);
        self::assertInstanceOf(\stdClass::class, $document, $file);

        return $document;
    }

    public function testFindsGoldenFiles(): void
    {
        self::assertNotEmpty($this->goldenFilesEnding('.ir.json'));
        self::assertNotEmpty($this->goldenFilesEnding('.source-map.json'));
    }

    public function testGoldenIrsReadAndWriteBackEqual(): void
    {
        $support = IrSupport::ofModel(kinds: ['httpOperation']);

        foreach ($this->goldenFilesEnding('.ir.json') as $file) {
            $contract = IrReader::read($this->text($file), $support);

            self::assertSame(
                Documents::canonical($this->document($file)),
                Documents::canonical($contract->toJson()),
                $file,
            );
        }
    }

    public function testGoldenSideTablesReadAndWriteBackEqual(): void
    {
        foreach ($this->goldenFilesEnding('.source-map.json') as $file) {
            $document = $this->document($file);

            self::assertSame(
                Documents::canonical($document),
                Documents::canonical(SourceMap::fromJson($document)->toJson()),
                $file,
            );
        }
    }
}
