<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Laravel\Runtime;

use Symfony\Component\HttpFoundation\Response;

/**
 * The one rule both PHP targets map a framework exception on a contract route with (ADR 0023 and 0024 "Exceptions on contract routes"):
 * the code of its role when the operation declares one, else the operation's single code of the exception's HTTP
 * status, answered with the params its role binding renders from the role's data (the `rateLimited` delay a
 * `Retry-After` header gives) when they hold every required param, or without params when it declares no required
 * one; else none, which the boundary answers with the api's logged 500. An HTTP exception takes the role of its
 * status: 401, 403, 404, 429 and 503, and a role exception that carries no status (`findOrFail()`) takes the status of
 * its role.
 */
final class FrameworkRefusal
{
    private const RETRY_AFTER = 'Retry-After';
    private const RATE_LIMITED_ROLE = 'rateLimited';
    private const RETRY_AFTER_SLOT = 'retryAfterMs';
    private const MILLISECONDS_PER_SECOND = 1000;
    // The schema maximum of `retryAfterMs`: a longer delay is capped, as JavaScript's largest safe integer.
    private const MAXIMUM_DELAY_MS = 9007199254740991;
    private const MAXIMUM_DELAY_SECONDS_DIGITS = 13;
    private const DELTA_SECONDS = '/^[0-9]+$/D';
    private const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    private const SHORT_DAYS = 'Mon|Tue|Wed|Thu|Fri|Sat|Sun';
    private const LONG_DAYS = 'Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday';
    private const MONTH_NAMES = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';
    private const CLOCK = '([0-9]{2}):([0-9]{2}):([0-9]{2})';
    // The three HTTP-date forms of RFC 9110 section 5.6.7, each read as UTC.
    private const IMF_FIXDATE = '/^(?:' . self::SHORT_DAYS . '), ([0-9]{2}) (' . self::MONTH_NAMES . ') ([0-9]{4}) ' . self::CLOCK . ' GMT$/D';
    private const RFC_850_DATE = '/^(?:' . self::LONG_DAYS . '), ([0-9]{2})-(' . self::MONTH_NAMES . ')-([0-9]{2}) ' . self::CLOCK . ' GMT$/D';
    private const ASCTIME_DATE = '/^(?:' . self::SHORT_DAYS . ') (' . self::MONTH_NAMES . ') +([0-9]{1,2}) ' . self::CLOCK . ' ([0-9]{4})$/D';
    private const RFC_850_FUTURE_LIMIT_YEARS = 50;
    private const CENTURY = 100;
    private const HTTP_EXCEPTION = 'Symfony\\Component\\HttpKernel\\Exception\\HttpExceptionInterface';
    private const STATUS_ROLES = [
        401 => 'unauthenticated',
        403 => 'forbidden',
        404 => ApiContract::NOT_FOUND_ROLE,
        429 => self::RATE_LIMITED_ROLE,
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
     * code first, else the operation's single code of the status, with the params its role binding renders from the
     * role's data, when they hold every required param, else without params when it declares no required one.
     *
     * @param list<string> $retryAfterValues the `Retry-After` values the refusal carries, in order; the first usable one gives the delay
     * @return ?array{code: string, params: ?\stdClass}
     */
    public static function answerOf(ApiContract $contract, ?string $operationId, ?string $role, ?int $status, array $retryAfterValues, int $nowSeconds): ?array
    {
        $code = self::candidateOf($contract, $operationId, $role, $status);
        if ($code === null) {
            return null;
        }

        // Only the `rateLimited` role has data a refusal gives: the delay of its `Retry-After`.
        $boundRole = $role ?? ($status === null ? null : self::roleOfStatus($status));
        $roleData = $boundRole === self::RATE_LIMITED_ROLE ? self::retryAfterFacts($retryAfterValues, $nowSeconds) : null;
        $params = $roleData === null ? null : self::filledRoleParams($contract, $operationId, $code, self::RATE_LIMITED_ROLE, $roleData);
        if ($params !== null) {
            return ['code' => $code, 'params' => $params];
        }

        return self::requiredParams($contract, $code) === [] ? ['code' => $code, 'params' => null] : null;
    }

    /**
     * The `Retry-After` values of the framework's reply, then of an HTTP exception's own headers, in that order.
     *
     * @return list<string>
     */
    public static function retryAfterValuesOf(?\Throwable $exception, Response $response): array
    {
        $values = [];
        foreach ($response->headers->all(self::RETRY_AFTER) as $value) {
            if (is_string($value)) {
                $values[] = $value;
            }
        }

        $headers = self::statusOf($exception) !== null && $exception !== null && method_exists($exception, 'getHeaders') ? $exception->getHeaders() : [];
        foreach (is_array($headers) ? $headers : [] as $name => $value) {
            if (is_string($name) && strcasecmp($name, self::RETRY_AFTER) === 0) {
                array_push($values, ...self::headerValueTexts($value));
            }
        }

        return $values;
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
     * The params the role binding renders from the role's data, or by name over every param of the code when the
     * operation binds no template; null when they miss a required param or hold none.
     *
     * @param array<string, mixed> $roleData
     */
    private static function filledRoleParams(ApiContract $contract, ?string $operationId, string $code, string $role, array $roleData): ?\stdClass
    {
        $template = $operationId === null ? null : $contract->roleParams($operationId, $code, $role);
        $params = $template === null ? self::byNameParams($contract, $code, $roleData) : Replies::roleParams($contract, (string) $operationId, $code, $role, $roleData);
        if ($params === null || get_object_vars($params) === []) {
            return null;
        }

        foreach (self::requiredParams($contract, $code) as $required) {
            if (!property_exists($params, $required)) {
                return null;
            }
        }

        return $params;
    }

    /** @param array<string, mixed> $roleData */
    private static function byNameParams(ApiContract $contract, string $code, array $roleData): \stdClass
    {
        $params = new \stdClass();
        foreach (array_keys(self::paramProperties($contract, $code)) as $name) {
            if (array_key_exists($name, $roleData)) {
                $params->{$name} = $roleData[$name];
            }
        }

        return $params;
    }

    /**
     * The params of a code that have neither a default nor `optional` (a param with a default is not required).
     *
     * @return list<string>
     */
    private static function requiredParams(ApiContract $contract, string $code): array
    {
        $required = [];
        foreach (self::paramProperties($contract, $code) as $name => $property) {
            if (($property['optional'] ?? false) !== true && !array_key_exists('default', $property)) {
                $required[] = $name;
            }
        }

        return $required;
    }

    /** @return array<string, array<array-key, mixed>> the properties of a code's params schema, by name */
    private static function paramProperties(ApiContract $contract, string $code): array
    {
        $schema = Ir::string($contract->catalogEntry($code), 'params');
        if ($schema === null) {
            return [];
        }

        $properties = [];
        foreach (Ir::maps($contract->declaration('schemas', $schema), 'properties') as $property) {
            $name = Ir::string($property, 'name');
            if ($name === null) {
                throw new \LogicException("The generated contract names no property in the params schema {$schema} of {$code}; regenerate it.");
            }
            $properties[$name] = $property;
        }

        return $properties;
    }

    /**
     * The `rateLimited` role's data: the delay of the first usable `Retry-After` value, none when no value is usable.
     *
     * @param list<string> $retryAfterValues
     * @return ?array{retryAfterMs: int}
     */
    private static function retryAfterFacts(array $retryAfterValues, int $nowSeconds): ?array
    {
        foreach ($retryAfterValues as $value) {
            $delayMs = self::delayMsOf($value, $nowSeconds);
            if ($delayMs !== null) {
                return [self::RETRY_AFTER_SLOT => $delayMs];
            }
        }

        return null;
    }

    /** @return list<string> a header value as a framework holds it (a string, a number or a list of them), as its texts */
    private static function headerValueTexts(mixed $value): array
    {
        if (is_array($value)) {
            return array_merge(...array_map(self::headerValueTexts(...), array_values($value)));
        }

        return is_string($value) || is_int($value) ? [(string) $value] : [];
    }

    // RFC 9110 `Retry-After`: delta-seconds, or an HTTP date whose past answers no delay, capped at the schema maximum.
    private static function delayMsOf(string $retryAfter, int $nowSeconds): ?int
    {
        $value = trim($retryAfter);
        if (preg_match(self::DELTA_SECONDS, $value) === 1) {
            $seconds = ltrim($value, '0');
            if (strlen($seconds) > self::MAXIMUM_DELAY_SECONDS_DIGITS) {
                return self::MAXIMUM_DELAY_MS;
            }

            return min((int) $seconds * self::MILLISECONDS_PER_SECOND, self::MAXIMUM_DELAY_MS);
        }

        $date = self::httpDateSeconds($value, $nowSeconds);

        return $date === null ? null : min(max($date - $nowSeconds, 0) * self::MILLISECONDS_PER_SECOND, self::MAXIMUM_DELAY_MS);
    }

    private static function httpDateSeconds(string $value, int $nowSeconds): ?int
    {
        if (preg_match(self::IMF_FIXDATE, $value, $imf) === 1) {
            return self::utcSeconds((int) $imf[3], $imf[2], (int) $imf[1], array_slice($imf, 4));
        }

        if (preg_match(self::RFC_850_DATE, $value, $rfc850) === 1) {
            return self::utcSeconds(self::rfc850Year((int) $rfc850[3], $nowSeconds), $rfc850[2], (int) $rfc850[1], array_slice($rfc850, 4));
        }

        if (preg_match(self::ASCTIME_DATE, $value, $asctime) === 1) {
            return self::utcSeconds((int) $asctime[6], $asctime[1], (int) $asctime[2], array_slice($asctime, 3, 3));
        }

        return null;
    }

    // RFC 9110: a two-digit year more than 50 years ahead of now means the past century.
    private static function rfc850Year(int $twoDigits, int $nowSeconds): int
    {
        $currentYear = (int) gmdate('Y', $nowSeconds);
        $year = intdiv($currentYear, self::CENTURY) * self::CENTURY + $twoDigits;

        return $year - $currentYear > self::RFC_850_FUTURE_LIMIT_YEARS ? $year - self::CENTURY : $year;
    }

    /**
     * The date as UTC seconds; null when a field overflows (31 Feb, 25:00), so no date is invented.
     *
     * @param array<int, string> $clock hours, minutes and seconds
     */
    private static function utcSeconds(int $year, string $month, int $day, array $clock): ?int
    {
        [$hour, $minute, $second] = array_map(intval(...), array_values($clock));
        $monthIndex = array_search($month, self::MONTHS, true);
        if ($monthIndex === false) {
            return null;
        }

        $seconds = gmmktime($hour, $minute, $second, $monthIndex + 1, $day, $year);
        if ($seconds === false) {
            return null;
        }
        $exact = gmdate('j G i s', $seconds) === sprintf('%d %d %02d %02d', $day, $hour, $minute, $second);

        return $exact ? $seconds : null;
    }
}
