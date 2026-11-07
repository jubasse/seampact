<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Bundle;

use PHPUnit\Framework\TestCase;
use Seampact\Ir\Bundle\BundleFailureCode;
use Seampact\Ir\Bundle\BundleTarball;
use Seampact\Ir\Tests\Support\Documents;
use Seampact\Ir\Tests\Support\Json;
use Seampact\Ir\Tests\Support\TemporaryDirectory;

/** The tarball reader's own bounds: a gzip bomb ends with the named cap under PHP's default memory limit. */
final class BundleTarballTest extends TestCase
{
    private const VECTORS = '/packages/core/spec/vectors/bundle/vectors.json';

    private const DEFAULT_MEMORY_LIMIT = '128M';

    // 260 MiB of zeros, over the 256 MiB extracted cap, gzipped to about 260 KB.
    private const BOMB_MEBIBYTES = 260;

    public function testRefusesAGzipBombByNameUnderTheDefaultMemoryLimit(): void
    {
        $directory = TemporaryDirectory::create('seampact-bomb-');

        try {
            $script = TemporaryDirectory::write($directory, 'bomb.php', self::bombScript());
            $output = self::runPhp($script, self::DEFAULT_MEMORY_LIMIT);
        } finally {
            TemporaryDirectory::remove($directory);
        }

        self::assertSame(BundleFailureCode::ArchiveExtractedTooLarge->value, trim($output));
    }

    public function testRefusesBytesAfterTheGzipStream(): void
    {
        $read = BundleTarball::read(self::validTarball() . 'trailing');

        self::assertCount(1, $read->failures);
        self::assertSame(BundleFailureCode::ArchiveInvalid, $read->failures[0]->code);
        self::assertStringContainsString('after the end of the gzip data', $read->failures[0]->message);
    }

    private static function validTarball(): string
    {
        $vectors = Json::object(Json::decodeFile(Documents::repositoryRoot() . self::VECTORS));

        foreach (Json::objects($vectors, 'archives') as $vector) {
            if (Json::string($vector, 'id') === 'valid') {
                $tarball = base64_decode(Json::string($vector, 'base64'), true);
                self::assertIsString($tarball);

                return $tarball;
            }
        }

        self::fail('The bundle vectors hold no valid archive.');
    }

    private static function bombScript(): string
    {
        $autoload = var_export(dirname(__DIR__, 2) . '/vendor/autoload.php', true);
        $mebibytes = self::BOMB_MEBIBYTES;

        return <<<PHP
            <?php
            require {$autoload};
            \$deflate = deflate_init(ZLIB_ENCODING_GZIP, ['level' => 1]);
            \$zeros = str_repeat("\\0", 1024 * 1024);
            \$bomb = '';
            for (\$i = 0; \$i < {$mebibytes}; \$i++) {
                \$bomb .= deflate_add(\$deflate, \$zeros, ZLIB_NO_FLUSH);
            }
            \$bomb .= deflate_add(\$deflate, '', ZLIB_FINISH);
            unset(\$zeros);
            \$read = Seampact\\Ir\\Bundle\\BundleTarball::read(\$bomb);
            echo \$read->failures === [] ? 'accepted' : \$read->failures[0]->code->value;
            PHP;
    }

    private static function runPhp(string $script, string $memoryLimit): string
    {
        $process = proc_open([PHP_BINARY, '-d', "memory_limit={$memoryLimit}", $script], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        self::assertIsResource($process);

        $output = (string) stream_get_contents($pipes[1]);
        $errors = (string) stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        proc_close($process);

        return $output . $errors;
    }
}
