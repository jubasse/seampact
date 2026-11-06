<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\WireCodec;
use Seampact\Codegen\Tests\Support\ReferenceContract;
use Seampact\Hooks\Field;
use Seampact\Symfony\SymfonyGenerator;

/** A member both optional and nullable, added to the generated getTasksBatch body: what the handler's typed input holds for an absent key, a null and a value. */
final class AbsentVersusNullTest extends TestCase
{
    private const NAMESPACE_ROOT = 'Seampact\\Behaviour\\Absent';

    private static string $generatedDirectory;

    public static function setUpBeforeClass(): void
    {
        self::$generatedDirectory = sys_get_temp_dir() . '/seampact-symfony-absent-' . bin2hex(random_bytes(6));
        $generator = new SymfonyGenerator();
        $document = ReferenceContract::withBatchInputMembers(
            ReferenceContract::kept(ReferenceContract::document(ReferenceContract::TASKS), ['getTasksBatch']),
            [['note', true, true, ['kind' => 'scalar', 'type' => 'string', 'refinements' => new \stdClass()]]],
        );
        $ir = ReferenceContract::read($generator, $document);

        foreach ($generator->generate($ir, ReferenceContract::entry(SymfonyGenerator::PACKAGE, 'tasks', self::NAMESPACE_ROOT)) as $file) {
            $target = self::$generatedDirectory . '/' . str_replace('\\', '/', self::NAMESPACE_ROOT) . "/{$file->path}";
            if (!is_dir(dirname($target))) {
                mkdir(dirname($target), 0o700, true);
            }
            file_put_contents($target, $file->contents);
        }

        spl_autoload_register(static function (string $className): void {
            $path = self::$generatedDirectory . '/' . str_replace('\\', '/', $className) . '.php';
            if (str_starts_with($className, self::NAMESPACE_ROOT . '\\') && is_file($path)) {
                require $path;
            }
        });
    }

    public static function tearDownAfterClass(): void
    {
        $paths = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(self::$generatedDirectory, \FilesystemIterator::SKIP_DOTS), \RecursiveIteratorIterator::CHILD_FIRST);
        foreach ($paths as $path) {
            if ($path instanceof \SplFileInfo) {
                $path->isDir() ? rmdir($path->getPathname()) : unlink($path->getPathname());
            }
        }
        rmdir(self::$generatedDirectory);
    }

    public function testAnAbsentMemberReachesTheHandlerAsAbsentAndAnExplicitNullAsNull(): void
    {
        $contract = ApiContract::of(self::NAMESPACE_ROOT . '\\Symfony\\TasksContract');
        $note = static function (string $json) use ($contract): mixed {
            $body = WireCodec::decode($contract, ['kind' => 'ref', 'schema' => 'GetTasksBatchInput'], json_decode($json, false, 512, JSON_THROW_ON_ERROR));
            self::assertIsObject($body);

            return get_object_vars($body)['note'] ?? null;
        };

        self::assertEquals(Field::absent(), $note('{"ids":[]}'));
        self::assertEquals(Field::ofNull(), $note('{"ids":[],"note":null}'));
        self::assertEquals(Field::of('x'), $note('{"ids":[],"note":"x"}'));
    }
}
