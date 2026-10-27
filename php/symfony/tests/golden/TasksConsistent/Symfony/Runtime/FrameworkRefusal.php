<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony\Runtime;

/**
 * The one rule both PHP targets map a framework exception on a contract route with (ADR 0023 and 0024 "Exceptions on contract routes"):
 * the code of its role when the operation declares one, else the operation's single code of the exception's HTTP
 * status that declares no required params (a param with a default is not required), else none, which the boundary
 * answers with the api's logged 500. An HTTP exception takes the role of its status: 401, 403, 404, 429 and 503, and a
 * role exception that carries no status (`findOrFail()`) takes the status of its role.
 */
final class FrameworkRefusal
{
    private const HTTP_EXCEPTION = 'Symfony\\Component\\HttpKernel\\Exception\\HttpExceptionInterface';
    private const STATUS_ROLES = [
        401 => 'unauthenticated',
        403 => 'forbidden',
        404 => ApiContract::NOT_FOUND_ROLE,
        429 => 'rateLimited',
        503 => 'serviceUnavailable',
    ];

    private function __construct()
    {
    }

    /** The status of an HTTP exception (Symfony's `HttpExceptionInterface`, which `abort()` throws too), null for any other. */
    public static function statusOf(?\Throwable $exception): ?int
    {
        // Read by name, as the shared runtime does not depend on symfony/http-kernel.
        $interfaces = $exception === null ? false : class_implements($exception);
        if ($exception === null || $interfaces === false || !isset($interfaces[self::HTTP_EXCEPTION]) || !method_exists($exception, 'getStatusCode')) {
            return null;
        }

        $status = $exception->getStatusCode();

        return is_int($status) ? $status : null;
    }

    public static function roleOfStatus(int $status): ?string
    {
        return self::STATUS_ROLES[$status] ?? null;
    }

    /** The role of an HTTP exception's status, null for another exception or an unmapped status. */
    public static function statusRoleOf(?\Throwable $exception): ?string
    {
        $status = self::statusOf($exception);

        return $status === null ? null : self::roleOfStatus($status);
    }

    /** The code that answers the refusal, null when the operation declares none the rule picks. */
    public static function codeOf(ApiContract $contract, ?string $operationId, ?string $role, ?int $status): ?string
    {
        $status ??= self::statusOfRole($role);
        $roleCode = $role === null ? null : $contract->roleCode($operationId, $role);
        if ($roleCode !== null || $operationId === null || $status === null) {
            return $roleCode;
        }

        $codes = [];
        foreach (Ir::maps($contract->operation($operationId), 'errors') as $error) {
            $code = Ir::string($error, 'code') ?? '';
            if ($contract->statusOf($code) === $status) {
                $codes[] = $code;
            }
        }

        return count($codes) === 1 && !self::requiresParams($contract, $codes[0]) ? $codes[0] : null;
    }

    private static function statusOfRole(?string $role): ?int
    {
        $status = $role === null ? false : array_search($role, self::STATUS_ROLES, true);

        return $status === false ? null : $status;
    }

    // A code with a required param has no value to write for it, so the rule never picks it.
    private static function requiresParams(ApiContract $contract, string $code): bool
    {
        $schema = Ir::string($contract->catalogEntry($code), 'params');
        if ($schema === null) {
            return false;
        }

        foreach (Ir::maps($contract->declaration('schemas', $schema), 'properties') as $property) {
            if (($property['optional'] ?? false) !== true && !array_key_exists('default', $property)) {
                return true;
            }
        }

        return false;
    }
}
