<?php

declare(strict_types=1);

namespace App\Controller;

use App\Suite\SuiteControl;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

/** The suite's control routes (ADR 0015 "Control routes"). */
final class SuiteControlController
{
    public function loadScript(Request $request): Response
    {
        $problem = SuiteControl::load($request->getContent());

        return $problem === null ? new Response('', 204) : new Response($problem, 400, ['Content-Type' => 'text/plain']);
    }

    public function hookCalls(): JsonResponse
    {
        return new JsonResponse(['calls' => SuiteControl::hookCalls()]);
    }

    public function logLines(): JsonResponse
    {
        return new JsonResponse(['lines' => SuiteControl::logLines()]);
    }
}
