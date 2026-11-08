<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\OutgoingCheck;
use Seampact\Codegen\Tests\Support\Compressed;
use Seampact\Codegen\Tests\Support\ScriptedHooks;
use Seampact\Hooks\RequestView;
use Symfony\Component\HttpFoundation\Response;

/** Step 10: only a reply the boundary wrote, or a declared error another writer sent with a declared code, leaves. */
final class OutgoingCheckTest extends TestCase
{
    private const PROBLEM_MEDIA = 'application/problem+json';

    public function testAReplyTheBoundaryWrotePasses(): void
    {
        $state = self::state();
        $reply = $state->author(new Response('{"anything":1}', 200));

        self::assertNull(OutgoingCheck::violation($state, $reply));
    }

    public function testAReplyEditedAfterTheBoundaryWroteItIsNoLongerTheBoundarys(): void
    {
        $state = self::state();
        $reply = $state->author(new Response('{"anything":1}', 200));
        $reply->setContent('{"leak":1}');

        self::assertSame('a 200 reply the boundary did not write', OutgoingCheck::violation($state, $reply));
    }

    public function testASuccessTheBoundaryDidNotWriteIsAViolation(): void
    {
        self::assertSame('a 204 reply the boundary did not write', OutgoingCheck::violation(self::state(), new Response('', 204)));
    }

    public function testARedirectTheBoundaryDidNotWriteIsAViolation(): void
    {
        self::assertSame('a 302 reply the boundary did not write', OutgoingCheck::violation(self::state(), new Response('', 302)));
    }

    public function testAnUndeclaredErrorStatusIsAViolation(): void
    {
        self::assertSame('the undeclared status 418', OutgoingCheck::violation(self::state(), new Response('{}', 418)));
    }

    public function testADeclaredErrorWithADeclaredCodePasses(): void
    {
        self::assertNull(OutgoingCheck::violation(self::state(), self::problem(404, 'api.not_found')));
    }

    public function testADeclaredErrorWrittenAfterTheAccessStepAdmittedIsAViolation(): void
    {
        $state = self::state();
        $state->admitted = true;

        self::assertSame(
            "a 404 reply written after the boundary's access step admitted the request",
            OutgoingCheck::violation($state, self::problem(404, 'api.not_found')),
        );
    }

    public function testACodeDeclaredForAnotherStatusIsAViolation(): void
    {
        self::assertSame('a 404 error body without a declared code', OutgoingCheck::violation(self::state(), self::problem(404, 'api.rate_limited')));
    }

    public function testACodeTheOperationDoesNotDeclareIsAViolation(): void
    {
        self::assertSame('a 404 error body without a declared code', OutgoingCheck::violation(self::state(), self::problem(404, 'made.up')));
    }

    public function testACodeThatIsNotAStringIsAViolation(): void
    {
        $reply = new Response('{"code":404}', 404, ['Content-Type' => self::PROBLEM_MEDIA]);

        self::assertSame('a 404 error body without a declared code', OutgoingCheck::violation(self::state(), $reply));
    }

    public function testABodyThatIsNotAnObjectHasNoCode(): void
    {
        $reply = new Response('["api.not_found"]', 404, ['Content-Type' => self::PROBLEM_MEDIA]);

        self::assertSame('a 404 error body without a declared code', OutgoingCheck::violation(self::state(), $reply));
    }

    public function testAnErrorBodyInAnotherMediaTypeIsAViolation(): void
    {
        $reply = new Response('{"code":"api.not_found"}', 404, ['Content-Type' => 'application/json']);

        self::assertSame('a 404 error body that is not application/problem+json', OutgoingCheck::violation(self::state(), $reply));
    }

    public function testAMediaTypeParameterAndCaseAreIgnored(): void
    {
        $reply = new Response('{"code":"api.not_found"}', 404, ['Content-Type' => 'Application/Problem+JSON; charset=utf-8']);

        self::assertNull(OutgoingCheck::violation(self::state(), $reply));
    }

    public function testAnErrorBodyThatIsNotJsonIsAViolation(): void
    {
        $reply = new Response('<html>oops</html>', 404, ['Content-Type' => self::PROBLEM_MEDIA]);

        self::assertSame('a 404 error body that is not JSON', OutgoingCheck::violation(self::state(), $reply));
    }

    public function testAnErrorBodyAboveTheCheckedSizeCannotBeChecked(): void
    {
        $body = '{"code":"api.not_found","pad":"' . str_repeat('a', OutgoingCheck::MAX_CHECKED_ERROR_BODY_BYTES) . '"}';
        $reply = new Response($body, 404, ['Content-Type' => self::PROBLEM_MEDIA]);

        self::assertSame('a 404 error body that cannot be checked', OutgoingCheck::violation(self::state(), $reply));
    }

    public function testAGzipErrorBodyIsDecodedBeforeItsCodeIsRead(): void
    {
        $reply = new Response(Compressed::gzip('{"code":"api.not_found"}'), 404, ['Content-Type' => self::PROBLEM_MEDIA, 'Content-Encoding' => 'gzip']);

        self::assertNull(OutgoingCheck::violation(self::state(), $reply));
    }

    public function testADeflateErrorBodyIsDecodedBeforeItsCodeIsRead(): void
    {
        $reply = new Response(Compressed::deflate('{"code":"api.not_found"}'), 404, ['Content-Type' => self::PROBLEM_MEDIA, 'Content-Encoding' => 'deflate']);

        self::assertNull(OutgoingCheck::violation(self::state(), $reply));
    }

    public function testACorruptGzipErrorBodyIsNotJson(): void
    {
        $reply = new Response('not gzip', 404, ['Content-Type' => self::PROBLEM_MEDIA, 'Content-Encoding' => 'gzip']);

        self::assertSame('a 404 error body that is not JSON', OutgoingCheck::violation(self::state(), $reply));
    }

    private static function problem(int $status, string $code): Response
    {
        return new Response(json_encode(['code' => $code], JSON_THROW_ON_ERROR), $status, ['Content-Type' => self::PROBLEM_MEDIA]);
    }

    private static function state(): BoundaryState
    {
        return new BoundaryState(ApiContract::of(ThrottledContract::class), 'createTask', [], new RequestView('POST', '/v1/tasks', []), ScriptedHooks::none());
    }
}
