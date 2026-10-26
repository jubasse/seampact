<?php

declare(strict_types=1);

namespace App\Suite;

use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\KernelEvents;

/** The app's CORS layer, as a CORS bundle would answer a preflight: any origin, before routing. */
#[AsEventListener(event: KernelEvents::REQUEST, priority: 250)]
final class PreflightListener
{
    public function __invoke(RequestEvent $event): void
    {
        $request = $event->getRequest();
        if ($request->getMethod() !== 'OPTIONS' || !$request->headers->has('origin') || !$request->headers->has('access-control-request-method')) {
            return;
        }

        $event->setResponse(new Response('', Response::HTTP_NO_CONTENT, [
            'Access-Control-Allow-Origin' => '*',
            'Access-Control-Allow-Methods' => 'GET, POST, PUT, PATCH, DELETE',
        ]));
    }
}
