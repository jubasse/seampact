<?php

declare(strict_types=1);

namespace App\Suite;

use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpFoundation\RequestMatcherInterface;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * An app listener after the firewall on the tasks api's identity routes only, found through the generated
 * `seampact.tasks.matcher.identity` request matcher: the `X-Suite-Native-Layer` header `abort-401`, `abort-403` or
 * `abort-429` throws Symfony's `HttpException` of that status, as an app's own layer would. Without the header the
 * request passes.
 */
#[AsEventListener(event: KernelEvents::REQUEST, priority: 0)]
final class NativeLayersListener
{
    public const HEADER = 'x-suite-native-layer';
    private const ABORT_PREFIX = 'abort-';

    public function __construct(
        #[Autowire(service: 'seampact.tasks.matcher.identity')] private readonly RequestMatcherInterface $identityRoutes,
    ) {
    }

    public function __invoke(RequestEvent $event): void
    {
        $request = $event->getRequest();
        $layer = $request->headers->get(self::HEADER);
        if (!$event->isMainRequest() || !is_string($layer) || !str_starts_with($layer, self::ABORT_PREFIX) || !$this->identityRoutes->matches($request)) {
            return;
        }

        throw new HttpException((int) substr($layer, strlen(self::ABORT_PREFIX)), 'the app layer refuses this request');
    }
}
