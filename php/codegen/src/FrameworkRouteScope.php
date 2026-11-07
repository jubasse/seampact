<?php

declare(strict_types=1);

namespace Seampact\Codegen;

/**
 * Which app routes the framework-route boot check reads (`artefacts.bootCheck.frameworkRoutes`): `contract`, the
 * default, those that can serve a path under one of the api's (mounted) base paths; `strict` every app route.
 */
enum FrameworkRouteScope: string
{
    case Contract = 'contract';
    case Strict = 'strict';

    /** The scope of an entry's `artefacts`, already checked against the app config schema. */
    public static function of(\stdClass $artefacts): self
    {
        $bootCheck = $artefacts->bootCheck ?? null;
        $switch = $bootCheck instanceof \stdClass ? ($bootCheck->frameworkRoutes ?? null) : null;

        return $switch === self::Strict->value ? self::Strict : self::Contract;
    }
}
