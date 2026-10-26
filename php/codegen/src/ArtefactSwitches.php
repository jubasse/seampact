<?php

declare(strict_types=1);

namespace Seampact\Codegen;

/**
 * The artefact switches a PHP framework target reads (ADR 0023 and 0024 "Refused by name or waiting"): `bootCheck`
 * and `accessHooks: true` come with the target's boundary release, `accessHooks: false` with its native access
 * release; any other key is refused as unknown.
 */
final readonly class ArtefactSwitches
{
    private const BOOT_CHECK = 'bootCheck';
    private const ACCESS_HOOKS = 'accessHooks';

    /**
     * @param string $boundaryRelease the release that brings the boot check and hooks access, such as 'symfony-2'
     * @param string $nativeAccessRelease the release that brings native access, such as 'symfony-4'
     */
    public function __construct(private string $target, private string $boundaryRelease, private string $nativeAccessRelease)
    {
    }

    public function read(\stdClass $artefacts, Refusals $refusals): void
    {
        foreach (get_object_vars($artefacts) as $artefact => $value) {
            $artefact = (string) $artefact;
            $at = IrPlace::root()->below('artefacts', $artefact);
            $release = match ($artefact) {
                self::BOOT_CHECK => $this->boundaryRelease,
                self::ACCESS_HOOKS => $value === false ? $this->nativeAccessRelease : $this->boundaryRelease,
                default => null,
            };
            if ($release !== null) {
                $refusals->waitingForRelease("artefacts.{$artefact}", "The artefact switch '{$artefact}: " . json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES) . "'", $at, $release);
                continue;
            }
            $refusals->add(
                'artefacts.unknown',
                "The artefact '{$artefact}' is not one the {$this->target} target declares; it takes '" . self::BOOT_CHECK . "' and '" . self::ACCESS_HOOKS . "'.",
                "Remove '{$artefact}' from the entry's `artefacts`.",
                $at,
            );
        }
    }
}
