<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\ReplyVerdict;
use Seampact\Codegen\Tests\Support\ScriptedHooks;
use Seampact\Hooks\RequestView;
use Symfony\Component\HttpFoundation\Response;

/** Step 10 on a reply no exception rule answered: the `responses` mode judges a violation, the `frameworkEtag` mode a foreign ETag. */
final class ReplyVerdictTest extends TestCase
{
    private const ETAG = '"v1"';

    public function testStrictModeReplacesAViolationWithTheInternalErrorAndLogsIt(): void
    {
        $hooks = ScriptedHooks::none();
        $foreign = new Response('<html>teapot</html>', 418, ['ETag' => self::ETAG]);

        $reply = ReplyVerdict::checked(self::state($hooks), $foreign, null, 'strict', null);

        self::assertNotSame($foreign, $reply);
        self::assertSame(500, $reply->getStatusCode());
        self::assertFalse($reply->headers->has('ETag'), 'The replacement carries nothing of the replaced reply.');
        self::assertCount(1, $hooks->logged);
        self::assertStringContainsString('replaced the undeclared status 418', $hooks->logged[0]);
    }

    public function testAnyModeButStrictLetsTheViolationThroughAndLogsIt(): void
    {
        foreach ([null, 'warn', 'anything-else'] as $mode) {
            $hooks = ScriptedHooks::none();
            $foreign = new Response('<html>teapot</html>', 418);

            $reply = ReplyVerdict::checked(self::state($hooks), $foreign, null, $mode, null);

            self::assertSame($foreign, $reply, "mode " . var_export($mode, true));
            self::assertCount(1, $hooks->logged);
            self::assertStringContainsString('let through the undeclared status 418 (responses: warn)', $hooks->logged[0]);
        }
    }

    public function testAReplyTheBoundaryWroteIsNeverJudged(): void
    {
        $hooks = ScriptedHooks::none();
        $state = self::state($hooks);
        $own = $state->author(new Response('{"ok":true}', 200));

        self::assertSame($own, ReplyVerdict::checked($state, $own, null, 'strict', null));
        self::assertSame([], $hooks->logged);
    }

    public function testAForeignETagIsStrippedUnlessTheOperationKeepsIt(): void
    {
        $stripped = ReplyVerdict::checked(self::state(ScriptedHooks::none()), new Response('', 404, ['ETag' => self::ETAG]), null, 'warn', null);
        $kept = ReplyVerdict::checked(self::state(ScriptedHooks::none()), new Response('', 404, ['ETag' => self::ETAG]), null, 'warn', 'keep');

        self::assertFalse($stripped->headers->has('ETag'));
        self::assertSame(self::ETAG, $kept->headers->get('ETag'));
    }

    public function testTheETagTheBoundaryWroteIsKept(): void
    {
        $state = self::state(ScriptedHooks::none());
        $own = $state->author(new Response('{}', 200, ['ETag' => self::ETAG]));

        self::assertSame(self::ETAG, ReplyVerdict::checked($state, $own, null, 'strict', null)->headers->get('ETag'));
    }

    public function testAnETagTheBoundaryWroteButAHandlerChangedIsStripped(): void
    {
        $state = self::state(ScriptedHooks::none());
        $reply = $state->author(new Response('{}', 200, ['ETag' => self::ETAG]));
        $reply->headers->set('ETag', '"other"');

        $checked = ReplyVerdict::checked($state, $reply, null, 'warn', null);

        self::assertFalse($checked->headers->has('ETag'));
    }

    public function testANativeRefusalWithNoCodeToAnswerItIsTheInternalErrorNamingTheRole(): void
    {
        $hooks = ScriptedHooks::none();

        $reply = ReplyVerdict::mapped(self::state($hooks), new Response('', 403), 'noSuchRole', null, [], []);

        self::assertSame(500, $reply->getStatusCode());
        self::assertStringContainsString("with the role 'noSuchRole'", $hooks->logged[0]);
    }

    private static function state(ScriptedHooks $hooks): BoundaryState
    {
        return new BoundaryState(ApiContract::of(ThrottledContract::class), 'createTask', [], new RequestView('POST', '/v1/tasks', []), $hooks);
    }
}
