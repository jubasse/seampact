<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\ArtefactSwitches;
use Seampact\Codegen\Refusals;
use Seampact\Ir\Config\ConfigProblem;
use Seampact\Ir\Run\GenerationRefusedException;

final class ArtefactSwitchesTest extends TestCase
{
    public function testEachSwitchWaitsForTheReleaseThatBringsIt(): void
    {
        $refused = self::refused((object) ['bootCheck' => true, 'accessHooks' => false, 'nativeDocs' => true]);

        self::assertStringContainsString('symfony-2 generates it', $refused['artefacts.bootCheck.unsupported'] ?? '');
        self::assertStringContainsString('symfony-4 generates it', $refused['artefacts.accessHooks.unsupported'] ?? '');
        self::assertStringContainsString("it takes 'bootCheck' and 'accessHooks'", $refused['artefacts.unknown'] ?? '');
    }

    public function testHooksAccessComesWithTheBoundaryRelease(): void
    {
        self::assertStringContainsString('symfony-2 generates it', self::refused((object) ['accessHooks' => true])['artefacts.accessHooks.unsupported'] ?? '');
    }

    /** @return array<string, string> */
    private static function refused(\stdClass $artefacts): array
    {
        $refusals = new Refusals('server', 'symfony', 'seampact/symfony');
        (new ArtefactSwitches('symfony', 'symfony-2', 'symfony-4'))->read($artefacts, $refusals);

        try {
            $refusals->throwIfAny();
        } catch (GenerationRefusedException $refused) {
            $messages = [];
            foreach ($refused->problems as $problem) {
                self::assertInstanceOf(ConfigProblem::class, $problem);
                $messages[$problem->code] = $problem->message;
            }

            return $messages;
        }

        self::fail('No artefact switch was refused.');
    }
}
