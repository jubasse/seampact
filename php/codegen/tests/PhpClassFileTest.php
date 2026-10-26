<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\PhpClassFile;

final class PhpClassFileTest extends TestCase
{
    private const FIELD = 'Seampact\\Hooks\\Field';

    public function testAFreeShortNameIsImported(): void
    {
        $file = new PhpClassFile('App\\Schemas\\Task');

        self::assertSame('Field', $file->name(self::FIELD));
        self::assertSame(['Field' => self::FIELD], $file->namespace->getUses());
    }

    public function testATypeDeclarationStaysQualifiedAndImportsItsShortName(): void
    {
        $file = new PhpClassFile('App\\Symfony\\TasksRouteLoader');

        self::assertSame('Symfony\\Component\\Config\\Loader\\Loader', $file->type('Symfony\\Component\\Config\\Loader\\Loader'));
        self::assertSame(['Loader' => 'Symfony\\Component\\Config\\Loader\\Loader'], $file->namespace->getUses());
    }

    public function testASameNamespaceClassKeepsItsShortNameFromALaterImport(): void
    {
        $file = new PhpClassFile('App\\Schemas\\Task');

        self::assertSame('Field', $file->name('App\\Schemas\\Field'));
        self::assertSame('\\' . self::FIELD, $file->name(self::FIELD));
        self::assertSame([], $file->namespace->getUses());
    }

    public function testASameNamespaceClassAfterAnImportOfItsShortNameStaysQualified(): void
    {
        $file = new PhpClassFile('App\\Schemas\\Task');

        self::assertSame('Field', $file->name(self::FIELD));
        self::assertSame('\\App\\Schemas\\Field', $file->name('App\\Schemas\\Field'));
    }

    public function testTheTypesOwnShortNameIsNeverImported(): void
    {
        $file = new PhpClassFile('App\\Schemas\\Field');

        self::assertSame('\\' . self::FIELD, $file->name(self::FIELD));
    }

    public function testThePathFollowsTheNamespaceBelowTheRoot(): void
    {
        self::assertSame('Schemas/Field.php', (new PhpClassFile('App\\Tasks\\Schemas\\Field'))->path('App\\Tasks'));
    }
}
