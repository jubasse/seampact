<?php

declare(strict_types=1);

namespace App\Suite;

use Seampact\ConsumerSuite\ScriptedReply;
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Event\ExceptionEvent;
use Symfony\Component\HttpKernel\KernelEvents;

/** The app's own exception listener, at the default priority: it writes the reply a `ScriptedReply` carries. */
#[AsEventListener(event: KernelEvents::EXCEPTION)]
final class ScriptedReplyListener
{
    public function __invoke(ExceptionEvent $event): void
    {
        $exception = $event->getThrowable();
        if ($exception instanceof ScriptedReply) {
            $event->setResponse(new JsonResponse($exception->body(), $exception->status(), $exception->headers()));
        }
    }
}
