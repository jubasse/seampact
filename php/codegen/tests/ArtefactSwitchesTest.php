<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\ArtefactSwitches;
use Seampact\Codegen\BootCheckSwitches;
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
        self::assertStringContainsString("it takes 'bootCheck', 'accessHooks' and 'routeHelpers'", $refused['artefacts.unknown'] ?? '');
    }

    public function testHooksAccessComesWithTheBoundaryRelease(): void
    {
        self::assertStringContainsString('symfony-2 generates it', self::refused((object) ['accessHooks' => true])['artefacts.accessHooks.unsupported'] ?? '');
    }

    public function testAReleasedBoundaryTakesTheBootCheckAndHooksAccess(): void
    {
        $refusals = new Refusals('server', 'laravel', 'seampact/laravel');
        (new ArtefactSwitches('laravel', null, 'laravel-4'))->read((object) ['bootCheck' => (object) ['frameworkRoutes' => false, 'hooks' => 'off'], 'accessHooks' => true], $refusals);

        self::assertTrue($refusals->isEmpty());
    }

    public function testTheRouteHelpersSwitchIsReadAndOnByDefault(): void
    {
        $refusals = new Refusals('server', 'laravel', 'seampact/laravel');
        (new ArtefactSwitches('laravel', null, 'laravel-4'))->read((object) ['routeHelpers' => false], $refusals);

        self::assertTrue($refusals->isEmpty());
        self::assertFalse(ArtefactSwitches::routeHelpersOn((object) ['routeHelpers' => false]));
        self::assertTrue(ArtefactSwitches::routeHelpersOn(new \stdClass()));
    }

    public function testAReleasedBoundaryStillRefusesHooksWarn(): void
    {
        $refused = self::refused((object) ['bootCheck' => (object) ['hooks' => 'warn']], null);

        self::assertStringContainsString('it waits for an app that needs it', $refused['artefacts.bootCheck.hooks.warn.unsupported'] ?? '');
    }

    public function testTheBootCheckSwitchesFollowTheEntry(): void
    {
        self::assertSame(['hooks' => true, 'handlers' => true, 'frameworkRoutes' => true], BootCheckSwitches::of(new \stdClass())?->toArray());
        self::assertNull(BootCheckSwitches::of((object) ['bootCheck' => false]));
        self::assertSame(
            ['hooks' => false, 'handlers' => true, 'frameworkRoutes' => false],
            BootCheckSwitches::of((object) ['bootCheck' => (object) ['frameworkRoutes' => false, 'hooks' => 'off']])?->toArray(),
        );
    }

    /** @return array<string, string> */
    private static function refused(\stdClass $artefacts, ?string $boundaryRelease = 'symfony-2'): array
    {
        $refusals = new Refusals('server', 'symfony', 'seampact/symfony');
        (new ArtefactSwitches('symfony', $boundaryRelease, 'symfony-4'))->read($artefacts, $refusals);

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
