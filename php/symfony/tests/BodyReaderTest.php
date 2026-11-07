<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\BodyReader;
use Symfony\Component\HttpFoundation\Request;

/** The body is read through the request, so an in-process request (`KernelBrowser` or `jsonRequest()` in a functional test) sends its body. */
final class BodyReaderTest extends TestCase
{
    private const BODY = '{"ids":["a"]}';
    private const LIMIT_BYTES = 1024;

    public function testAnInProcessRequestBodyIsRead(): void
    {
        $request = Request::create('/v1/channels/c1/tasks/batch', 'POST', [], [], [], ['CONTENT_TYPE' => 'application/json'], self::BODY);

        $read = BodyReader::read($request, self::LIMIT_BYTES);

        self::assertNull($read->refusedRole);
        self::assertSame(self::BODY, $read->bytes);
        self::assertSame(self::BODY, $request->getContent(), 'The app still reads the body as received.');
    }
}
