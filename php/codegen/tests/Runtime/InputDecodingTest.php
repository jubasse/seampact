<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\ContractRefusal;
use Seampact\Codegen\Runtime\DecodedInput;
use Seampact\Codegen\Runtime\InputDecoding;
use Seampact\Codegen\Tests\Support\Compressed;
use Seampact\Codegen\Tests\Support\ScriptedHooks;
use Seampact\Hooks\RequestView;
use Symfony\Component\HttpFoundation\Request;

/** Step 1 on a request: the path, query and header values as their types read them, and the bounded body decoded as JSON. */
final class InputDecodingTest extends TestCase
{
    private const BODY = '{"title":"write the tests"}';

    public function testTheBodyIsDecodedWithItsObjectsPreserved(): void
    {
        $state = self::state();

        InputDecoding::read(self::request('{"a":{},"b":[]}'), $state);

        self::assertEquals((object) ['a' => new \stdClass(), 'b' => []], $state->body);
    }

    public function testPathQueryAndHeaderValuesAreReadAsTheirTypesSayAndAnUndeclaredQueryKeyStaysText(): void
    {
        $state = self::state(rawParameters: ['taskId' => '42']);
        $request = self::request(self::BODY, query: 'page=3&tag=a&tag=b%20c&other=x&other=y&single=z');
        $request->headers->set('X-Attempt', '2');

        $decoded = InputDecoding::read($request, $state);

        self::assertInstanceOf(DecodedInput::class, $decoded);
        self::assertSame(['taskId' => 42], $decoded->path);
        self::assertSame(['page' => 3, 'tag' => ['a', 'b c'], 'other' => ['x', 'y'], 'single' => 'z'], $decoded->query);
        self::assertSame(['X-Attempt' => 2], $decoded->headers);
    }

    public function testAHeaderThatIsNotItsTypeStaysTextForTheSchemaToRefuse(): void
    {
        $request = self::request(self::BODY);
        $request->headers->set('X-Attempt', 'two');

        self::assertSame(['X-Attempt' => 'two'], InputDecoding::read($request, self::state(rawParameters: ['taskId' => '1']))->headers);
    }

    public function testAPathValueThatIsNotUtf8IsRefusedAsAnInvalidPath(): void
    {
        $refusal = self::refusal(self::request(self::BODY), self::state(rawParameters: ['taskId' => '%FF']));

        self::assertSame('api.invalid', $refusal->contractCode);
    }

    public function testABodyOfAnotherMediaTypeIsUnsupported(): void
    {
        $request = self::request(self::BODY, contentType: 'text/plain');

        self::assertSame('api.media', self::refusal($request)->contractCode);
    }

    public function testAMediaTypeParameterAndCaseAreIgnored(): void
    {
        $state = self::state();

        InputDecoding::read(self::request(self::BODY, contentType: 'Application/JSON; charset=utf-8'), $state);

        self::assertNotNull($state->body);
    }

    public function testABodyPastTheLimitIsTooLargeWhateverItsMediaType(): void
    {
        $request = self::request(str_repeat('a', 2048), contentType: 'text/plain');

        self::assertSame('api.too_large', self::refusal($request)->contractCode);
    }

    public function testABodyThatInflatesPastTheLimitIsTooLarge(): void
    {
        $request = self::request(Compressed::gzip('"' . str_repeat('a', 50000) . '"'), encoding: 'gzip');

        self::assertSame('api.too_large', self::refusal($request)->contractCode);
    }

    public function testAGzipBodyWithinTheLimitIsDecoded(): void
    {
        $state = self::state();

        InputDecoding::read(self::request(Compressed::gzip(self::BODY), encoding: 'gzip'), $state);

        self::assertEquals((object) ['title' => 'write the tests'], $state->body);
    }

    public function testAnUnknownContentEncodingIsUnsupported(): void
    {
        self::assertSame('api.media', self::refusal(self::request(self::BODY, encoding: 'br'))->contractCode);
    }

    public function testACorruptStreamIsAnInvalidBody(): void
    {
        $refusal = self::refusal(self::request('not gzip at all', encoding: 'gzip'));

        self::assertSame('api.invalid', $refusal->contractCode);
    }

    public function testBytesThatAreNotJsonAreAnInvalidBody(): void
    {
        self::assertSame('api.invalid', self::refusal(self::request('{"title":'))->contractCode);
    }

    public function testNestingJustUnderTheDepthLimitIsDecodedAndTheLimitItselfIsRefused(): void
    {
        $state = self::state();
        InputDecoding::read(self::request(self::nested(511)), $state);

        self::assertIsArray($state->body);
        self::assertSame('api.invalid', self::refusal(self::request(self::nested(512)))->contractCode);
    }

    public function testNoBodyLeavesTheBodyNull(): void
    {
        $state = self::state();

        InputDecoding::read(Request::create('/v1/tasks/1/upload', 'POST'), $state);

        self::assertNull($state->body);
    }

    public function testABodyUnderAGzipCodingThatDecodesToNothingLeavesTheBodyNull(): void
    {
        $state = self::state();

        InputDecoding::read(self::request('', encoding: 'gzip', length: 1), $state);

        self::assertNull($state->body);
    }

    public function testTheBytesAsReceivedAreKeptForASignedRoute(): void
    {
        $state = self::state('uploadRaw');

        InputDecoding::read(self::request(self::BODY), $state);

        self::assertSame(self::BODY, $state->rawBody);
    }

    public function testALimitWithoutACodeForTheRefusalIsALogicError(): void
    {
        $this->expectException(\LogicException::class);
        $this->expectExceptionMessage("no code for the role 'payloadTooLarge'");
        InputDecoding::read(self::request(str_repeat('a', 2048)), self::state('uploadUncoded'));
    }

    private static function refusal(Request $request, ?BoundaryState $state = null): ContractRefusal
    {
        try {
            InputDecoding::read($request, $state ?? self::state());
        } catch (ContractRefusal $refusal) {
            return $refusal;
        }

        self::fail('The request was decoded.');
    }

    /** @param array<string, string> $rawParameters */
    private static function state(string $operationId = 'upload', array $rawParameters = []): BoundaryState
    {
        return new BoundaryState(ApiContract::of(BodyContract::class), $operationId, $rawParameters, new RequestView('POST', '/v1/tasks/1/upload', []), ScriptedHooks::none());
    }

    private static function nested(int $levels): string
    {
        return str_repeat('[', $levels) . str_repeat(']', $levels);
    }

    private static function request(string $body, string $contentType = 'application/json', ?string $encoding = null, string $query = '', ?int $length = null): Request
    {
        $request = Request::create('/v1/tasks/1/upload' . ($query === '' ? '' : "?{$query}"), 'POST', [], [], [], ['CONTENT_TYPE' => $contentType], $body);
        $request->headers->set('Content-Length', (string) ($length ?? strlen($body)));
        if ($encoding !== null) {
            $request->headers->set('Content-Encoding', $encoding);
        }

        return $request;
    }
}
