<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony\Runtime;

use Symfony\Component\DependencyInjection\Attribute\Exclude;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\RequestMatcherInterface;

/**
 * The request matcher of one access kind of an api (ADR 0024 "Native security layers"), the service
 * `seampact.<api>.matcher.<kind>` the app names in `access_control` (`request_matcher:`) or a firewall: it matches a
 * request whose method and raw path step 1 matches to an operation of that kind, so a public template never covers its
 * identity sibling. A path no operation serves matches no kind.
 */
#[Exclude]
final class KindRequestMatcher implements RequestMatcherInterface
{
    public const SERVICE_PREFIX = 'seampact.';
    public const SERVICE_INFIX = '.matcher.';

    /** @param array<string, array{operation: string, kind: string}> $access the generated access table, by route name */
    public function __construct(
        private readonly string $contractClass,
        private readonly array $access,
        private readonly string $kind,
    ) {
    }

    public static function serviceId(string $api, string $kind): string
    {
        return self::SERVICE_PREFIX . $api . self::SERVICE_INFIX . $kind;
    }

    public function matches(Request $request): bool
    {
        $contract = ApiContract::of($this->contractClass);
        $operationId = $contract->match($request->getMethod(), RawTarget::path($request))?->operationId;
        if ($operationId === null) {
            return false;
        }

        $route = $this->access[$contract->routeName($operationId)] ?? null;
        if ($route === null) {
            throw new \LogicException("seampact: the access table of api '{$contract->api}' has no route for operation '{$operationId}'; regenerate the code.");
        }

        return $route['kind'] === $this->kind;
    }
}
