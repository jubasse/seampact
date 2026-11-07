<?php

declare(strict_types=1);

namespace Seampact\Codegen;

/**
 * The artefact switches a PHP framework target reads (ADR 0023 and 0024 "Refused by name or waiting"): `bootCheck`
 * and `accessHooks: true` come with the target's boundary release, `accessHooks: false` with its native access
 * release or, on a target that names none, waits for a consumer; `routeHelpers` turns the route helpers on or off; any
 * other key is refused as unknown. Once the boundary release is out, only `bootCheck.hooks: warn` waits.
 */
final readonly class ArtefactSwitches
{
    private const BOOT_CHECK = 'bootCheck';
    private const ACCESS_HOOKS = 'accessHooks';
    private const ROUTE_HELPERS = 'routeHelpers';
    private const HOOKS_WARN = 'warn';

    /**
     * @param ?string $boundaryRelease the release that brings the boot check and hooks access, such as 'symfony-2';
     *     null once the target generates them
     * @param string|Delivery $nativeAccessRelease the release that brings native access, such as 'symfony-4', or why
     *     it waits when no release brings it
     */
    public function __construct(private string $target, private ?string $boundaryRelease, private string|Delivery $nativeAccessRelease)
    {
    }

    /** Whether the entry keeps the route helpers (`RouteHelpers`), on unless `routeHelpers: false`. */
    public static function routeHelpersOn(\stdClass $artefacts): bool
    {
        return ($artefacts->{self::ROUTE_HELPERS} ?? true) !== false;
    }

    public function read(\stdClass $artefacts, Refusals $refusals): void
    {
        foreach (get_object_vars($artefacts) as $artefact => $value) {
            $artefact = (string) $artefact;
            $at = IrPlace::root()->below('artefacts', $artefact);
            if ($artefact === self::BOOT_CHECK || $artefact === self::ACCESS_HOOKS) {
                $this->readKnown($artefact, $value, $at, $refusals);
                continue;
            }
            if ($artefact === self::ROUTE_HELPERS) {
                continue;
            }
            $refusals->add(
                'artefacts.unknown',
                "The artefact '{$artefact}' is not one the {$this->target} target declares; it takes '" . self::BOOT_CHECK . "', '" . self::ACCESS_HOOKS . "' and '" . self::ROUTE_HELPERS . "'.",
                "Remove '{$artefact}' from the entry's `artefacts`.",
                $at,
            );
        }
    }

    private function readKnown(string $artefact, mixed $value, IrPlace $at, Refusals $refusals): void
    {
        $release = $artefact === self::ACCESS_HOOKS && $value === false ? $this->nativeAccessRelease : $this->boundaryRelease;
        $switch = "The artefact switch '{$artefact}: " . json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES) . "'";
        if ($release instanceof Delivery) {
            $refusals->waiting("artefacts.{$artefact}", $switch, $at, $release);

            return;
        }

        if ($release !== null) {
            $refusals->waitingForRelease("artefacts.{$artefact}", $switch, $at, $release);

            return;
        }

        if ($artefact === self::BOOT_CHECK && $value instanceof \stdClass && ($value->hooks ?? null) === self::HOOKS_WARN) {
            $refusals->waiting('artefacts.bootCheck.hooks.warn', "'bootCheck.hooks: warn' (start with hooks missing)", $at->below('hooks'), Delivery::Consumer);
        }
    }
}
