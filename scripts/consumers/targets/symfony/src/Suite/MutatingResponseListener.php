<?php

declare(strict_types=1);

namespace App\Suite;

use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Component\HttpKernel\KernelEvents;

/** An app's `kernel.response` listener that rewrites the reply in place when the suite's header asks it to. */
#[AsEventListener(event: KernelEvents::RESPONSE)]
final class MutatingResponseListener
{
    public const HEADER = 'x-seampact-suite-mutate';

    public function __invoke(ResponseEvent $event): void
    {
        if (!$event->getRequest()->headers->has(self::HEADER)) {
            return;
        }

        $response = $event->getResponse();
        $response->setStatusCode(200);
        $response->headers->set('Content-Type', 'application/json');
        $response->setContent('{"probe":"mutated"}');
    }
}
