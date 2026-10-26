<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Laravel\Runtime;

use Symfony\Component\HttpFoundation\Response;

/**
 * The verdict on a contract route's reply (ADR 0016), once the target has found where the reply and its exception
 * came from: a native refusal answered with its role's code, the api's 500 for the boundary's own failures, and step 10,
 * which strips an ETag the boundary did not set and judges the reply under the `responses` mode.
 */
final class ReplyVerdict
{
    private const INTERNAL_STATUS = 500;
    private const STRICT = 'strict';
    private const KEEP = 'keep';

    private function __construct()
    {
    }

    /**
     * Step 10 on a reply that no exception rule answered.
     *
     * @param mixed $responsesMode the operation's `responses` setting, `strict` unless it says otherwise
     * @param mixed $etagMode the operation's `frameworkEtag` setting, `strip` unless it says `keep`
     */
    public static function checked(BoundaryState $state, Response $response, ?\Throwable $exception, mixed $responsesMode, mixed $etagMode): Response
    {
        $etag = $response->headers->get('ETag');
        if ($etag !== null && $etag !== $state->authoredEtag($response) && $etagMode !== self::KEEP) {
            $response->headers->remove('ETag');
        }

        $violation = OutgoingCheck::violation($state, $response);
        if ($violation === null) {
            return $response;
        }

        if ($responsesMode !== self::STRICT) {
            BoundaryLog::unexpected($state->hooks, $state->contract, $state->operationId, "the outgoing check let through {$violation} (responses: warn)", $exception);

            return $response;
        }

        return self::internalError($state->hooks, $state->contract, $state->operationId, "the outgoing check replaced {$violation}", $exception);
    }

    /**
     * A native layer's refusal answered with its role's code, keeping the named headers of the framework's reply.
     *
     * @param list<string> $keptHeaders
     */
    public static function mapped(BoundaryState $state, Response $response, string $role, ?\Throwable $exception, array $keptHeaders): Response
    {
        $code = $state->contract->roleCode($state->operationId, $role);
        if ($code === null) {
            return self::internalError($state->hooks, $state->contract, $state->operationId, "a native layer refused with the role '{$role}', which the operation does not declare", $exception);
        }

        $reply = Replies::error($state->contract, $state->operationId, $code);
        foreach ($keptHeaders as $header) {
            if ($response->headers->has($header)) {
                $reply->headers->set($header, $response->headers->get($header));
            }
        }

        return $state->author($reply);
    }

    /** The api's 500, logged and told to the unexpected-error listener. */
    public static function internalError(HookLookup $hooks, ApiContract $contract, ?string $operationId, string $reason, ?\Throwable $cause): Response
    {
        BoundaryLog::unexpected($hooks, $contract, $operationId, $reason, $cause);

        return self::roleReply($contract, $operationId, ApiContract::UNDECLARED_STATUS_ROLE, self::INTERNAL_STATUS);
    }

    /** The role's code in the api's format, or a bare status when the api declares no code for the role. */
    public static function roleReply(ApiContract $contract, ?string $operationId, string $role, int $bareStatus): Response
    {
        $code = $contract->roleCode($operationId, $role);

        return $code === null ? new Response('', $bareStatus) : Replies::error($contract, $operationId, $code);
    }
}
