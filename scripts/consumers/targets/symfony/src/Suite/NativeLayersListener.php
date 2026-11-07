<?php

declare(strict_types=1);

namespace App\Suite;

use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpFoundation\RequestMatcherInterface;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Symfony\Component\HttpKernel\Exception\TooManyRequestsHttpException;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * An app listener after the firewall on the tasks api's identity routes only, found through the generated
 * `seampact.tasks.matcher.identity` request matcher: the `X-Suite-Native-Layer` header `abort-401`, `abort-403` or
 * `abort-429` throws Symfony's `HttpException` of that status, as an app's own layer would, and `throttle-<seconds>` or
 * `throttle-date` throws its `TooManyRequestsHttpException` with a `Retry-After` of that delay or of an HTTP date a
 * minute ahead. Without the header the request passes.
 */
#[AsEventListener(event: KernelEvents::REQUEST, priority: 0)]
final class NativeLayersListener
{
    public const HEADER = 'x-suite-native-layer';
    private const ABORT_PREFIX = 'abort-';
    private const THROTTLE_PREFIX = 'throttle-';
    private const THROTTLE_DATE = 'throttle-date';
    private const THROTTLE_DATE_DELAY_SECONDS = 60;
    private const ABORT_STATUSES = [401, 403, 429];

    public function __construct(
        #[Autowire(service: 'seampact.tasks.matcher.identity')] private readonly RequestMatcherInterface $identityRoutes,
    ) {
    }

    public function __invoke(RequestEvent $event): void
    {
        $request = $event->getRequest();
        $layer = $request->headers->get(self::HEADER);
        $isLayer = is_string($layer) && (str_starts_with($layer, self::ABORT_PREFIX) || str_starts_with($layer, self::THROTTLE_PREFIX));
        if (!$event->isMainRequest() || !$isLayer || !$this->identityRoutes->matches($request)) {
            return;
        }

        if (str_starts_with($layer, self::THROTTLE_PREFIX)) {
            throw new TooManyRequestsHttpException(self::retryAfterOf($layer), 'the app layer throttles this request');
        }

        $status = (int) substr($layer, strlen(self::ABORT_PREFIX));
        if (!in_array($status, self::ABORT_STATUSES, true)) {
            throw new \LogicException(self::HEADER . " '{$layer}' is not abort-401, abort-403 or abort-429");
        }

        throw new HttpException($status, 'the app layer refuses this request');
    }

    private static function retryAfterOf(string $layer): string
    {
        return $layer === self::THROTTLE_DATE
            ? gmdate(\DATE_RFC7231, time() + self::THROTTLE_DATE_DELAY_SECONDS)
            : substr($layer, strlen(self::THROTTLE_PREFIX));
    }
}
