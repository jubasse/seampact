<?php

declare(strict_types=1);

namespace App\Suite;

use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * An app's `kernel.response` listener that rewrites the reply when the suite's header asks it to: in place, or with a
 * new Response object when the header says `replace`.
 */
#[AsEventListener(event: KernelEvents::RESPONSE)]
final class MutatingResponseListener
{
    public const HEADER = 'x-seampact-suite-mutate';
    public const REPLACE = 'replace';

    public function __invoke(ResponseEvent $event): void
    {
        if (!$event->getRequest()->headers->has(self::HEADER)) {
            return;
        }

        if ($event->getRequest()->headers->get(self::HEADER) === self::REPLACE) {
            $event->setResponse(new Response('{"probe":"replaced"}', 200, ['Content-Type' => 'application/json']));

            return;
        }

        $response = $event->getResponse();
        $response->setStatusCode(200);
        $response->headers->set('Content-Type', 'application/json');
        $response->setContent('{"probe":"mutated"}');
    }
}
