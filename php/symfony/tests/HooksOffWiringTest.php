<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Tests\Support\ReferenceContract;
use Seampact\Symfony\SymfonyGenerator;

/** With the hook check off, the generated bundle still checks the input rules at warm-up and on the first request. */
final class HooksOffWiringTest extends TestCase
{
    public function testTheWarmerAsksOnlyTheInputRulesAndTheBoundaryStillChecksThem(): void
    {
        $files = (new SymfonyGenerator())->generate(
            ReferenceContract::core(new SymfonyGenerator()),
            ReferenceContract::entry(SymfonyGenerator::PACKAGE, 'tasks', 'App\\Tasks', [], ['bootCheck' => (object) ['hooks' => 'off']]),
        );
        $contents = [];
        foreach ($files as $file) {
            $contents[basename($file->path)] = $file->contents;
        }

        self::assertStringContainsString('WarmerChecks::InputRulesOnly', $contents['TasksSeampactBundle.php']);
        self::assertStringContainsString("checksHooks(): bool\n    {\n        return false;", $contents['TasksBoundary.php']);
        self::assertStringContainsString("checksInputRules(): bool\n    {\n        return true;", $contents['TasksBoundary.php']);
    }
}
