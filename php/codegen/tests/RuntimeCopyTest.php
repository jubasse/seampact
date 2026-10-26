<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\RuntimeCopy;

final class RuntimeCopyTest extends TestCase
{
    private string $directory;

    protected function setUp(): void
    {
        $this->directory = sys_get_temp_dir() . '/seampact-runtime-copy-' . bin2hex(random_bytes(4));
        mkdir($this->directory);
    }

    protected function tearDown(): void
    {
        array_map('unlink', glob($this->directory . '/*.php') ?: []);
        rmdir($this->directory);
    }

    public function testEachSourceMovesToTheRuntimeNamespace(): void
    {
        file_put_contents($this->directory . '/Rule.php', "<?php\n\nnamespace Seampact\\Symfony\\Runtime;\n\nfinal class Rule {}\n");

        $files = (new RuntimeCopy('Seampact\\Symfony\\Runtime', $this->directory, 'seampact/symfony'))->files('App\\Tasks', 'App\\Tasks\\Symfony\\Runtime');

        self::assertSame('Symfony/Runtime/Rule.php', $files[0]->path);
        self::assertStringContainsString("namespace App\\Tasks\\Symfony\\Runtime;\n", $files[0]->contents);
    }

    public function testASourceWithoutTheExactNamespaceLineIsRefusedByName(): void
    {
        file_put_contents($this->directory . '/Rule.php', "<?php\n\nnamespace  Seampact\\Symfony\\Runtime;\n\nfinal class Rule {}\n");

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Rule.php');
        (new RuntimeCopy('Seampact\\Symfony\\Runtime', $this->directory, 'seampact/symfony'))->files('App\\Tasks', 'App\\Tasks\\Symfony\\Runtime');
    }
}
