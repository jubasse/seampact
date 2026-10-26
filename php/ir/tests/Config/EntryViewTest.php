<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Config;

use PHPUnit\Framework\TestCase;
use Seampact\Ir\Config\AppConfig;
use Seampact\Ir\Config\AppConfigEntry;
use Seampact\Ir\Config\AppConfigReader;
use Seampact\Ir\Config\ConfigProblem;
use Seampact\Ir\Config\EntryView;
use Seampact\Ir\Config\JsonValue;
use Seampact\Ir\Config\SourceApi;
use Seampact\Ir\Tests\Support\Documents;
use Seampact\Ir\Tests\Support\Json;
use Seampact\Ir\Tests\Support\TemporaryDirectory;

/**
 * An entry's view of the reference contract's IR (`fixtures/golden/reference`), the operation lists the Node CLI's
 * `filterOperations` keeps for the same entries, and the refusals it gives: the cases the JVM reader passes too.
 */
final class EntryViewTest extends TestCase
{
    private SourceApi $tasks;

    private SourceApi $service;

    protected function setUp(): void
    {
        $this->tasks = new SourceApi('contract', 'tasks', self::irOf('tasks'));
        $this->service = new SourceApi('contract', 'tasksService', self::irOf('tasksService'));
    }

    public function testKeepsEveryOperationWithoutASelection(): void
    {
        self::assertSame(self::ids($this->tasks->ir), $this->viewedIds(self::entry()));
    }

    public function testAppliesTheDocumentThenIncludeThenExclude(): void
    {
        $public = $this->viewedIds(self::entry(['document' => 'public']));
        self::assertSame(array_values(array_diff(self::ids($this->tasks->ir), ['archiveTask', 'payments'])), $public);

        $included = $this->viewedIds(self::entry(['operations' => ['include' => ['getTask', 'listTasks', 'health'], 'exclude' => ['health']]]));
        self::assertSame(['getTask', 'listTasks'], $included);
    }

    public function testMatchesTagsAsOperationIds(): void
    {
        $tagged = new SourceApi('contract', 'tasks', self::withTag($this->tasks->ir, 'getTask', 'reads'));
        $view = EntryView::of(self::entry(['operations' => ['include' => ['reads']]]), [$tagged, $this->service]);

        self::assertSame(['getTask'], self::ids($view->apis[0]->ir));
    }

    public function testRefusesWhatTheNodeCliRefuses(): void
    {
        self::assertSame(['filter.document.unknown'], $this->codes(self::entry(['document' => 'partner'])));
        self::assertSame(['filter.operation.unknown'], $this->codes(self::entry(['operations' => ['exclude' => ['nothing']]])));
        self::assertSame(['filter.include.removed'], $this->codes(self::entry(['document' => 'public', 'operations' => ['include' => ['archiveTask']]])));
        self::assertSame(['config.api.unknown'], $this->codes(self::entry([], 'missing')));
        self::assertSame(
            ['config.api.ambiguous'],
            $this->codes(self::entry(), [$this->tasks, new SourceApi('other', 'tasks', $this->tasks->ir)]),
        );
        self::assertSame(['config.api.duplicate'], $this->codes(self::entry([], null, ['tasks', 'contract/tasks'])));
    }

    public function testKeepsTheRestOfTheIrAsItIsAndLeavesTheSourceUntouched(): void
    {
        $before = Documents::canonical($this->tasks->ir);
        $viewed = EntryView::of(self::entry(['document' => 'public']), [$this->tasks])->apis[0]->ir;

        self::assertSame(Documents::canonical(self::withoutOperations($this->tasks->ir)), Documents::canonical(self::withoutOperations($viewed)));
        self::assertSame($before, Documents::canonical($this->tasks->ir));
    }

    public function testUsesTheSourcesThatMayHoldAnApiNamedAloneAsTheNodeCliDoes(): void
    {
        $directory = TemporaryDirectory::create('seampact-view-');

        try {
            mkdir("{$directory}/.git");
            TemporaryDirectory::write($directory, 'listing/workspace.yaml', "workspace:\n  apis:\n    tasks: tasks.yaml\n");
            TemporaryDirectory::write($directory, 'other/api.yaml', "api:\n  name: billing\n");
            mkdir("{$directory}/unreadable");
            TemporaryDirectory::write(
                $directory,
                'app/seampact.config.yaml',
                "sources:\n  listing: { path: ../listing }\n  other: { path: ../other }\n  unreadable: { path: ../unreadable }\n"
                    . "  bundle: { release: { url: 'https://example.com/b.tgz' } }\n  named: { path: ../named }\n"
                    . "targets:\n  - { id: a, use: acme/a, api: tasks }\n  - { id: b, use: acme/b, api: named/x }\n",
            );
            $config = AppConfigReader::readFile("{$directory}/app/seampact.config.yaml");

            self::assertInstanceOf(AppConfig::class, $config);
            self::assertSame(['listing', 'unreadable', 'bundle', 'named'], EntryView::usedSources($config));
        } finally {
            TemporaryDirectory::remove($directory);
        }
    }

    private static function irOf(string $api): \stdClass
    {
        return Json::object(Json::decodeFile(Documents::repositoryRoot() . "/fixtures/golden/reference/{$api}.ir.json"));
    }

    /**
     * @param array<string, mixed> $members
     * @param ?list<string> $apis
     */
    private static function entry(array $members = [], ?string $api = 'tasks', ?array $apis = null): AppConfigEntry
    {
        $target = $apis === null ? ['api' => $api] : ['apis' => $apis];
        $json = json_encode(['id' => 'server', 'use' => 'acme/server', ...$target, ...$members], JSON_THROW_ON_ERROR);

        return new AppConfigEntry(Json::object(json_decode($json, false, 512, JSON_THROW_ON_ERROR)), '/out');
    }

    /** @return list<string> */
    private function viewedIds(AppConfigEntry $entry): array
    {
        $view = EntryView::of($entry, [$this->tasks, $this->service]);
        self::assertSame([], $view->problems);
        self::assertCount(1, $view->apis);

        return self::ids($view->apis[0]->ir);
    }

    /**
     * @param ?list<SourceApi> $apis
     * @return list<string>
     */
    private function codes(AppConfigEntry $entry, ?array $apis = null): array
    {
        $view = EntryView::of($entry, $apis ?? [$this->tasks, $this->service]);

        return array_map(static fn (ConfigProblem $problem): string => $problem->code, $view->problems);
    }

    /** @return list<string> */
    private static function ids(\stdClass $ir): array
    {
        return array_map(static fn (\stdClass $operation): string => Json::string($operation, 'id'), Json::objects($ir, 'operations'));
    }

    private static function withTag(\stdClass $ir, string $operationId, string $tag): \stdClass
    {
        $copy = Json::object(JsonValue::copy($ir));
        foreach (Json::objects($copy, 'operations') as $operation) {
            if (Json::string($operation, 'id') === $operationId) {
                $operation->tags = [$tag];
            }
        }

        return $copy;
    }

    private static function withoutOperations(\stdClass $ir): \stdClass
    {
        $copy = Json::object(JsonValue::copy($ir));
        unset($copy->operations);

        return $copy;
    }
}
