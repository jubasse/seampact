<?php

declare(strict_types=1);

namespace Seampact\Codegen;

/**
 * Which checks the boot check runs (ADR 0012 and the entry's `artefacts.bootCheck`): `true` or absent runs them all,
 * `false` none (`of` gives null), and `{ frameworkRoutes: false }` or `{ hooks: off }` turns one off.
 */
final readonly class BootCheckSwitches
{
    private const FRAMEWORK_ROUTES = 'frameworkRoutes';
    private const HOOKS = 'hooks';
    private const HOOKS_OFF = 'off';

    public function __construct(public bool $hooks, public bool $handlers, public bool $frameworkRoutes)
    {
    }

    /** The switches of an entry's `artefacts`, already checked against the app config schema; null when the check is off. */
    public static function of(\stdClass $artefacts): ?self
    {
        $bootCheck = $artefacts->bootCheck ?? true;
        if ($bootCheck === false) {
            return null;
        }

        $checks = $bootCheck instanceof \stdClass ? $bootCheck : new \stdClass();

        return new self(
            ($checks->{self::HOOKS} ?? null) !== self::HOOKS_OFF,
            true,
            ($checks->{self::FRAMEWORK_ROUTES} ?? true) !== false,
        );
    }

    /** @return array{hooks: bool, handlers: bool, frameworkRoutes: bool} */
    public function toArray(): array
    {
        return ['hooks' => $this->hooks, 'handlers' => $this->handlers, 'frameworkRoutes' => $this->frameworkRoutes];
    }
}
