<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\RuntimeCopy;
use Seampact\Codegen\RuntimeSource;

final class RuntimeCopyTest extends TestCase
{
    private const TARGET_NAMESPACE = 'Seampact\\Symfony\\Runtime';
    private const TARGET_PACKAGE = 'seampact/symfony';

    /** @var list<string> */
    private array $directories = [];

    protected function tearDown(): void
    {
        foreach ($this->directories as $directory) {
            array_map('unlink', glob($directory . '/*.php') ?: []);
            rmdir($directory);
        }
    }

    public function testEachSourceMovesToTheRuntimeNamespace(): void
    {
        $target = $this->directory(['Rule.php' => "<?php\n\nnamespace Seampact\\Symfony\\Runtime;\n\nfinal class Rule {}\n"]);

        $files = $this->copy(new RuntimeSource(self::TARGET_NAMESPACE, $target, self::TARGET_PACKAGE));

        self::assertSame('Symfony/Runtime/Rule.php', $files[0]->path);
        self::assertStringContainsString("namespace App\\Tasks\\Symfony\\Runtime;\n", $files[0]->contents);
    }

    public function testASourceWithoutTheExactNamespaceLineIsRefusedByName(): void
    {
        $target = $this->directory(['Rule.php' => "<?php\n\nnamespace  Seampact\\Symfony\\Runtime;\n\nfinal class Rule {}\n"]);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Rule.php');
        $this->copy(new RuntimeSource(self::TARGET_NAMESPACE, $target, self::TARGET_PACKAGE));
    }

    public function testASharedUseLineIsDroppedSinceBothSourcesLandInOneNamespace(): void
    {
        $shared = $this->directory(['Ir.php' => "<?php\n\nnamespace Seampact\\Codegen\\Runtime;\n\nfinal class Ir {}\n"]);
        $target = $this->directory([
            'Mixed.php' => "<?php\n\nnamespace Seampact\\Symfony\\Runtime;\n\nuse Psr\\Log\\LoggerInterface;\nuse Seampact\\Codegen\\Runtime\\Ir;\nuse Seampact\\Hooks\\Field;\n\nfinal class Mixed {}\n",
            'Only.php' => "<?php\n\nnamespace Seampact\\Symfony\\Runtime;\n\nuse Seampact\\Codegen\\Runtime\\Ir;\n\nfinal class Only {}\n",
        ]);

        $files = $this->copy(new RuntimeSource(RuntimeCopy::SHARED_NAMESPACE, $shared, 'seampact/codegen'), new RuntimeSource(self::TARGET_NAMESPACE, $target, self::TARGET_PACKAGE));

        self::assertSame(['Symfony/Runtime/Ir.php', 'Symfony/Runtime/Mixed.php', 'Symfony/Runtime/Only.php'], array_map(static fn ($file): string => $file->path, $files));
        self::assertSame("<?php\n\nnamespace App\\Tasks\\Symfony\\Runtime;\n\nuse Psr\\Log\\LoggerInterface;\nuse Seampact\\Hooks\\Field;\n\nfinal class Mixed {}\n", $files[1]->contents);
        self::assertSame("<?php\n\nnamespace App\\Tasks\\Symfony\\Runtime;\n\nfinal class Only {}\n", $files[2]->contents);
    }

    /** @return iterable<string, array{string}> */
    public static function leftoverReferences(): iterable
    {
        yield 'an aliased shared use' => ["use Seampact\\Codegen\\Runtime\\Ir as SharedIr;\n"];
        yield 'a fully qualified target name' => ["/** @see \\Seampact\\Laravel\\Runtime\\Hooks */\n"];
        yield 'a string spelling' => ["const NAME = 'Seampact\\\\Symfony\\\\Runtime\\\\Rule';\n"];
        yield 'a lower-case name' => ["/** @see \\seampact\\laravel\\Runtime\\Hooks */\n"];
        yield 'an upper-case name' => ["/** @see \\SEAMPACT\\LARAVEL\\RUNTIME\\Hooks */\n"];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('leftoverReferences')]
    public function testASeampactReferenceOtherThanTheHooksIsRefusedWithItsLine(string $line): void
    {
        $target = $this->directory(['Rule.php' => "<?php\n\nnamespace Seampact\\Symfony\\Runtime;\n\nuse Seampact\\Hooks\\Field;\n{$line}final class Rule {}\n"]);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Rule.php line 6');
        $this->copy(new RuntimeSource(self::TARGET_NAMESPACE, $target, self::TARGET_PACKAGE));
    }

    public function testAnEscapedDotAfterTheWordIsNotANamespace(): void
    {
        $target = $this->directory(['Rule.php' => "<?php\n\nnamespace Seampact\\Symfony\\Runtime;\n\nconst ROUTE = '/^seampact\\.([^.]+)\\./D';\n"]);

        self::assertCount(1, $this->copy(new RuntimeSource(self::TARGET_NAMESPACE, $target, self::TARGET_PACKAGE)));
    }

    public function testTheHooksPackageInEitherSpellingIsKept(): void
    {
        $target = $this->directory(['Rule.php' => "<?php\n\nnamespace Seampact\\Symfony\\Runtime;\n\nuse Seampact\\Hooks\\Field;\n\nconst HOOK = 'Seampact\\\\Hooks\\\\Field';\n"]);

        $files = $this->copy(new RuntimeSource(self::TARGET_NAMESPACE, $target, self::TARGET_PACKAGE));

        self::assertStringContainsString('use Seampact\\Hooks\\Field;', $files[0]->contents);
    }

    public function testAnAppNamespaceUnderSeampactIsNotALeftover(): void
    {
        $target = $this->directory(['Rule.php' => "<?php\n\nnamespace Seampact\\Symfony\\Runtime;\n\nfinal class Rule {}\n"]);

        $files = (new RuntimeCopy([new RuntimeSource(self::TARGET_NAMESPACE, $target, self::TARGET_PACKAGE)]))->files('Seampact\\Golden', 'Seampact\\Golden\\Symfony\\Runtime');

        self::assertStringContainsString("namespace Seampact\\Golden\\Symfony\\Runtime;\n", $files[0]->contents);
    }

    public function testTheAppNamespaceInAnotherCaseIsNotALeftover(): void
    {
        $target = $this->directory(['Rule.php' => "<?php\n\nnamespace Seampact\\Symfony\\Runtime;\n\n/** @see \\seampact\\golden\\symfony\\runtime\\Rule */\nfinal class Rule {}\n"]);

        $files = (new RuntimeCopy([new RuntimeSource(self::TARGET_NAMESPACE, $target, self::TARGET_PACKAGE)]))->files('Seampact\\Golden', 'Seampact\\Golden\\Symfony\\Runtime');

        self::assertCount(1, $files);
    }

    public function testOneFileNameInTwoSourcesIsRefusedWhateverItsCase(): void
    {
        $shared = $this->directory(['Ir.php' => "<?php\n\nnamespace Seampact\\Codegen\\Runtime;\n\nfinal class Ir {}\n"]);
        $target = $this->directory(['IR.php' => "<?php\n\nnamespace Seampact\\Symfony\\Runtime;\n\nfinal class IR {}\n"]);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('IR.php exists in both seampact/codegen and seampact/symfony');
        $this->copy(new RuntimeSource(RuntimeCopy::SHARED_NAMESPACE, $shared, 'seampact/codegen'), new RuntimeSource(self::TARGET_NAMESPACE, $target, self::TARGET_PACKAGE));
    }

    public function testNoSourceIsRefused(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('at least one runtime source');
        new RuntimeCopy([]);
    }

    public function testOneFileNameInTwoSourcesIsRefused(): void
    {
        $shared = $this->directory(['Rule.php' => "<?php\n\nnamespace Seampact\\Codegen\\Runtime;\n\nfinal class Rule {}\n"]);
        $target = $this->directory(['Rule.php' => "<?php\n\nnamespace Seampact\\Symfony\\Runtime;\n\nfinal class Rule {}\n"]);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Rule.php exists in both seampact/codegen and seampact/symfony');
        $this->copy(new RuntimeSource(RuntimeCopy::SHARED_NAMESPACE, $shared, 'seampact/codegen'), new RuntimeSource(self::TARGET_NAMESPACE, $target, self::TARGET_PACKAGE));
    }

    public function testAnEmptySourceIsRefusedNamingItsPackage(): void
    {
        $shared = $this->directory(['Ir.php' => "<?php\n\nnamespace Seampact\\Codegen\\Runtime;\n\nfinal class Ir {}\n"]);
        $empty = $this->directory([]);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('reinstall seampact/symfony');
        $this->copy(new RuntimeSource(RuntimeCopy::SHARED_NAMESPACE, $shared, 'seampact/codegen'), new RuntimeSource(self::TARGET_NAMESPACE, $empty, self::TARGET_PACKAGE));
    }

    /** @return list<\Seampact\Ir\Write\GeneratedFile> */
    private function copy(RuntimeSource ...$sources): array
    {
        return (new RuntimeCopy(array_values($sources)))->files('App\\Tasks', 'App\\Tasks\\Symfony\\Runtime');
    }

    /** @param array<string, string> $files */
    private function directory(array $files): string
    {
        $directory = sys_get_temp_dir() . '/seampact-runtime-copy-' . bin2hex(random_bytes(4));
        mkdir($directory);
        $this->directories[] = $directory;
        foreach ($files as $name => $contents) {
            file_put_contents("{$directory}/{$name}", $contents);
        }

        return $directory;
    }
}
