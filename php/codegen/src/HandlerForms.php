<?php

declare(strict_types=1);

namespace Seampact\Codegen;

use Seampact\Ir\Config\ConfigProblem;
use Seampact\Ir\Model\ContractIR;
use Seampact\Ir\Model\CredentialIdentity;
use Seampact\Ir\Model\HeaderDecl;
use Seampact\Ir\Model\HeaderSemantic;
use Seampact\Ir\Model\HeaderSide;
use Seampact\Ir\Model\HeaderUseFor;
use Seampact\Ir\Model\IdentityAccess;
use Seampact\Ir\Model\IdentityHeaderUse;
use Seampact\Ir\Model\Operation;
use Seampact\Ir\Model\OptionalAccess;
use Seampact\Ir\Model\SignedIdentity;

/**
 * The forms the generated boundary validates but does not enforce, which the handler owes: each is named with a
 * warning at generation, as on the Node servers (ADR 0016 "Left to the handler"), never dropped silently. An
 * identity's request `headers` are validated as declared headers only, so the handler reads them. An identity header
 * the server would write on a response (a versionToken, or a header declared `in: response`) has no value a handler
 * can write, a result carrying only a body, so it is refused by name at its declaration rather than dropped.
 */
final class HandlerForms
{
    public const string IDENTITY_HEADERS_HANDLER = 'identity.headers.handler';

    public const string IDENTITY_RESPONSE_HEADER = 'identity.response.header';

    private const string IDENTITY_HEADERS_FIX = 'Read the identity headers the boundary validated in the handler.';

    /**
     * One warning per operation whose identity declares request headers.
     *
     * @return list<ConfigProblem>
     */
    public static function warnings(ContractIR $ir, string $entryId, string $api): array
    {
        $warnings = [];
        foreach ($ir->operations as $index => $operation) {
            $headers = self::identityHeaders($ir, $operation);
            if ($headers === null || $headers['requestSideUses'] === 0) {
                continue;
            }

            $identityId = $headers['identityId'];

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

    /** Refuses by name each identity header an operation would write on its responses, at the header's declaration. */
    public static function refuseResponseHeaders(ContractIR $ir, Refusals $refusals): void
    {
        foreach ($ir->operations as $operation) {
            $headers = self::identityHeaders($ir, $operation);
            if ($headers === null) {
                continue;
            }

            foreach ($headers['responseSide'] as $headerId => $name) {
                $refusals->waiting(
                    self::IDENTITY_RESPONSE_HEADER,
                    "The response header '{$name}' of the identity '{$headers['identityId']}'",
                    new IrPlace('/headers/' . $headerId, $operation->id),
                    Delivery::AfterOneZero,
                );
            }
        }
    }

    /** @return array{identityId: string, requestSideUses: int, responseSide: array<string, string>}|null */
    private static function identityHeaders(ContractIR $ir, Operation $operation): ?array
    {
        $access = $operation->access;
        if (!$access instanceof IdentityAccess && !$access instanceof OptionalAccess) {
            return null;
        }

        $identity = $ir->identities[$access->identity] ?? null;
        if ((!$identity instanceof CredentialIdentity && !$identity instanceof SignedIdentity) || $identity->headers === []) {
            return null;
        }

        $requestSideUses = 0;
        $responseSide = [];
        foreach ($identity->headers as $use) {
            $declaration = $ir->headers[$use->header] ?? null;
            if ($declaration === null || !self::isResponseSide($declaration)) {
                ++$requestSideUses;
                continue;
            }

            $name = self::responseHeaderName($declaration, $use, $operation);
            if ($name !== null) {
                $responseSide[$use->header] = $name;
            }
        }

        return ['identityId' => $access->identity, 'requestSideUses' => $requestSideUses, 'responseSide' => $responseSide];
    }

    private static function isResponseSide(HeaderDecl $declaration): bool
    {
        return $declaration->semantic->value === HeaderSemantic::VersionToken || $declaration->in?->value === HeaderSide::Response;
    }

    // A versionToken answers on every success of the identity; another semantic only where its `for` applies. An
    // unknown `for` is taken to apply, so nothing is dropped unnamed.
    private static function responseHeaderName(HeaderDecl $declaration, IdentityHeaderUse $use, Operation $operation): ?string
    {
        if ($declaration->semantic->value === HeaderSemantic::VersionToken) {
            return $declaration->response;
        }

        if ($use->for->value === HeaderUseFor::Reads && !$operation->safe) {
            return null;
        }

        if ($use->for->value === HeaderUseFor::Writes && $operation->safe) {
            return null;
        }

        return $declaration->name;
    }
}
