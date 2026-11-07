<?php

declare(strict_types=1);

namespace Seampact\Codegen;

use Seampact\Ir\Model\ContractIR;
use Seampact\Ir\Model\CookieScheme;
use Seampact\Ir\Model\IdentityAccess;
use Seampact\Ir\Model\Operation;
use Seampact\Ir\Model\OptionalAccess;
use Seampact\Ir\Model\SignedIdentity;

/**
 * The access kind of an operation's route, which the PHP targets' native security layers key on (ADR 0023 and 0024
 * "Native security layers"): `public`, `optional` or `identity` from its access, or `signed` when its identity is
 * verified by a signature, so a webhook never shares the layers of a signed-in caller's routes.
 */
final class AccessKind
{
    public const SIGNED = 'signed';
    /** Every kind, in the order the targets list them. */
    public const ALL = ['public', 'optional', 'identity', self::SIGNED];

    private function __construct()
    {
    }

    public static function of(ContractIR $ir, Operation $operation): string
    {
        return self::isSigned($ir, $operation) ? self::SIGNED : $operation->access->tag();
    }

    public static function isSigned(ContractIR $ir, Operation $operation): bool
    {
        $access = $operation->access;
        $identity = $access instanceof IdentityAccess || $access instanceof OptionalAccess ? $ir->identities[$access->identity] ?? null : null;

        return $identity instanceof SignedIdentity;
    }

    /** Whether one of the operation's credential schemes is a cookie, the only credential a cross-site form can forge. */
    public static function readsCookie(ContractIR $ir, Operation $operation): bool
    {
        $access = $operation->access;
        $schemes = $access instanceof IdentityAccess || $access instanceof OptionalAccess ? $access->schemes : [];
        foreach ($schemes as $schemeId) {
            if (($ir->schemes[$schemeId] ?? null) instanceof CookieScheme) {
                return true;
            }
        }

        return false;
    }
}
