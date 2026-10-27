<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony\Runtime;

use Symfony\Component\HttpFoundation\Response;

/**
 * The one rule both PHP targets map a framework exception on a contract route with (ADR 0023 and 0024 "Exceptions on contract routes"):
 * the code of its role when the operation declares one, else the operation's single code of the exception's HTTP
 * status, answered when it declares no required params or when its one required param is the delay a `Retry-After`
 * header gives; else none, which the boundary answers with the api's logged 500. An HTTP exception takes the role of
 * its status: 401, 403, 404, 429 and 503, and a role exception that carries no status (`findOrFail()`) takes the
 * status of its role.
 */
final class FrameworkRefusal
{
    private const RETRY_AFTER = 'Retry-After';
    private const HTTP_DATE = 'D, d M Y H:i:s \\G\\M\\T';
    private const MILLISECONDS_PER_SECOND = 1000;
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

    /**
     * The code and params that answer the refusal, null when the operation declares none the rule picks: the role's
     * code first, else the operation's single code of the status. Either is answered when it declares no required
     * params, or when its one required param is the delay of a retry header and `$retryAfter` gives it.
     *
     * @param ?string $retryAfter the framework's `Retry-After`, delta-seconds or an HTTP date
     * @return ?array{code: string, params: ?\stdClass}
     */
    public static function answerOf(ApiContract $contract, ?string $operationId, ?string $role, ?int $status, ?string $retryAfter, int $nowSeconds): ?array
    {
        $code = self::candidateOf($contract, $operationId, $role, $status);
        if ($code === null) {
            return null;
        }

        $required = self::requiredParams($contract, $code);
        if ($required === []) {
            return ['code' => $code, 'params' => null];
        }

        $delayParam = self::retryDelayParam($contract, $code);
        $delayMs = $retryAfter === null ? null : self::delayMsOf($retryAfter, $nowSeconds);
        if ($required !== [$delayParam] || $delayParam === null || $delayMs === null) {
            return null;
        }

        return ['code' => $code, 'params' => (object) [$delayParam => $delayMs]];
    }

    /** The `Retry-After` of an HTTP exception's own headers, else of the framework's reply, null when neither has one. */
    public static function retryAfterOf(?\Throwable $exception, Response $response): ?string
    {
        $headers = self::statusOf($exception) !== null && $exception !== null && method_exists($exception, 'getHeaders') ? $exception->getHeaders() : [];
        foreach (is_array($headers) ? $headers : [] as $name => $value) {
            if (is_string($name) && strcasecmp($name, self::RETRY_AFTER) === 0 && (is_string($value) || is_int($value))) {
                return (string) $value;
            }
        }

        return $response->headers->get(self::RETRY_AFTER);
    }

    private static function candidateOf(ApiContract $contract, ?string $operationId, ?string $role, ?int $status): ?string
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

        return count($codes) === 1 ? $codes[0] : null;
    }

    private static function statusOfRole(?string $role): ?int
    {
        $status = $role === null ? false : array_search($role, self::STATUS_ROLES, true);

        return $status === false ? null : $status;
    }

    /**
     * The params of a code that have neither a default nor `optional` (a param with a default is not required).
     *
     * @return list<string>
     */
    private static function requiredParams(ApiContract $contract, string $code): array
    {
        $schema = Ir::string($contract->catalogEntry($code), 'params');
        if ($schema === null) {
            return [];
        }

        $required = [];
        foreach (Ir::maps($contract->declaration('schemas', $schema), 'properties') as $property) {
            if (($property['optional'] ?? false) !== true && !array_key_exists('default', $property)) {
                $required[] = Ir::string($property, 'name') ?? '';
            }
        }

        return $required;
    }

    // The param a retry header writes on this code: one convention for the api, so any operation's declaration names it.
    private static function retryDelayParam(ApiContract $contract, string $code): ?string
    {
        foreach (Ir::maps($contract->ir, 'operations') as $operation) {
            foreach (Ir::maps($operation, 'errors') as $error) {
                $param = Ir::string(Ir::map($error, 'retryHeader'), 'param');
                if ($param !== null && Ir::string($error, 'code') === $code) {
                    return $param;
                }
            }
        }

        return null;
    }

    // RFC 9110 `Retry-After`: delta-seconds, or an HTTP date whose past answers no delay; anything else gives none.
    private static function delayMsOf(string $retryAfter, int $nowSeconds): ?int
    {
        $value = trim($retryAfter);
        if (preg_match('/^[0-9]{1,15}$/', $value) === 1) {
            return (int) $value * self::MILLISECONDS_PER_SECOND;
        }

        $date = \DateTimeImmutable::createFromFormat(self::HTTP_DATE, $value, new \DateTimeZone('UTC'));
        if ($date === false || $date->format(self::HTTP_DATE) !== $value) {
            return null;
        }

        return max($date->getTimestamp() - $nowSeconds, 0) * self::MILLISECONDS_PER_SECOND;
    }
}
