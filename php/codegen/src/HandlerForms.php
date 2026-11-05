<?php

declare(strict_types=1);

namespace Seampact\Codegen;

use Seampact\Ir\Config\ConfigProblem;
use Seampact\Ir\Model\ContractIR;
use Seampact\Ir\Model\CredentialIdentity;
use Seampact\Ir\Model\IdentityAccess;
use Seampact\Ir\Model\Operation;
use Seampact\Ir\Model\OptionalAccess;
use Seampact\Ir\Model\SignedIdentity;

/**
 * The forms the generated boundary validates but does not enforce, which the handler owes: each is named with a
 * warning at generation, as on the Node servers (ADR 0016 "Left to the handler"), never dropped silently. An
 * identity's `headers` (the rights-version header among them) are validated as declared headers only, so the handler
 * compares the rights version and answers the stale-rights error.
 */
final class HandlerForms
{
    public const string IDENTITY_HEADERS_HANDLER = 'identity.headers.handler';

    private const string IDENTITY_HEADERS_FIX = 'Read the identity headers the boundary validated in the handler.';

    /**
     * One warning per operation whose identity declares headers.
     *
     * @return list<ConfigProblem>
     */
    public static function warnings(ContractIR $ir, string $entryId, string $api): array
    {
        $warnings = [];
        foreach ($ir->operations as $index => $operation) {
            $identityId = self::identityWithHeaders($ir, $operation);
            if ($identityId === null) {
                continue;
            }

            $place = IrPlace::ofOperation($index, $operation->id)->below('access');
            $warnings[] = new ConfigProblem(
                self::IDENTITY_HEADERS_HANDLER,
                "The headers of the identity '{$identityId}' in operation '{$operation->id}' at {$place->member} is not enforced by the generated boundary.",
                self::IDENTITY_HEADERS_FIX,
                $place->inEntry($entryId, $api),
            );
        }

        return $warnings;
    }

    private static function identityWithHeaders(ContractIR $ir, Operation $operation): ?string
    {
        $access = $operation->access;
        if (!$access instanceof IdentityAccess && !$access instanceof OptionalAccess) {
            return null;
        }

        $identity = $ir->identities[$access->identity] ?? null;
        if (($identity instanceof CredentialIdentity || $identity instanceof SignedIdentity) && $identity->headers !== []) {
            return $access->identity;
        }

        return null;
    }
}
