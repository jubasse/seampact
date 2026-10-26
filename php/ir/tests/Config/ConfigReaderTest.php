<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Config;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Seampact\Ir\Bundle\GitSource;
use Seampact\Ir\Bundle\RegistrySource;
use Seampact\Ir\Bundle\ReleaseSource;
use Seampact\Ir\Config\AppConfig;
use Seampact\Ir\Config\AppConfigReader;
use Seampact\Ir\Config\ConfigProblem;
use Seampact\Ir\Config\LocalSource;
use Seampact\Ir\Config\LocalSourcePolicy;
use Seampact\Ir\Tests\Support\TemporaryDirectory;

/** The app config reader on valid configs and on each refusal, with the Node CLI's codes. */
final class ConfigReaderTest extends TestCase
{
    private const VALID = <<<'YAML'
        sources:
          contract: { path: ../contract }
          shipped: { release: { url: 'https://example.test/b.tgz' }, integrity: 'sha256-mtw1LkRCB5fNlvCLQKDoVPotLMCs1ll2u6TKMmQzo6g=' }
          tagged: { git: { url: 'https://example.test/c.git', tag: v1, directory: bundle } }
          npm: { package: '@acme/contract', version: 1.0.0 }
        outDir: src/Generated
        targets:
          - id: laravel
            use: seampact/laravel
            api: contract/tasks
            operations: { include: [getTask], exclude: [] }
            options: { namespace: 'App\Generated' }
          - id: web
            use: '@seampact/codegen-fetch'
            apis: [tasks]
        openapi: none
        checks: { generated: warning }
        YAML;

    private string $project;

    protected function setUp(): void
    {
        $this->project = TemporaryDirectory::create('seampact-config-');
        mkdir("{$this->project}/.git");
    }

    protected function tearDown(): void
    {
        TemporaryDirectory::remove($this->project);
    }

    public function testReadsAValidConfigWithItsSourcesAndTheEntriesOfItsEcosystem(): void
    {
        $config = $this->read(self::VALID);

        self::assertInstanceOf(AppConfig::class, $config);
        self::assertSame("{$this->project}/app/src/Generated", $config->outDir);
        self::assertEquals(new LocalSource("{$this->project}/contract"), $config->sources['contract']);
        self::assertInstanceOf(ReleaseSource::class, $config->sources['shipped']);
        self::assertInstanceOf(GitSource::class, $config->sources['tagged']);
        self::assertSame('bundle', $config->sources['tagged']->directory);
        self::assertInstanceOf(RegistrySource::class, $config->sources['npm']);

        self::assertCount(1, $config->entries);
        self::assertSame('laravel', $config->entries[0]->id());
        self::assertSame("{$this->project}/app/src/Generated/laravel", $config->entries[0]->root);
        self::assertSame(['contract/tasks'], $config->entries[0]->apiRefs());
        self::assertSame(['getTask'], $config->entries[0]->include());
        self::assertSame('App\Generated', $config->entries[0]->options()->namespace);
        self::assertSame(['web'], array_map(static fn ($entry): string => $entry->id(), $config->otherEntries));
        self::assertSame('none', $config->openapi);
        self::assertSame('warning', $config->checks?->generated);
    }

    public function testKeepsTheEntriesItReturnsApartFromTheParsedValue(): void
    {
        $config = $this->read(self::VALID);
        self::assertInstanceOf(AppConfig::class, $config);

        $config->entries[0]->options()->namespace = 'Changed';

        self::assertSame('App\Generated', $config->entries[0]->options()->namespace);
    }

    /** @return array<string, array{string, list<string>}> */
    public static function refusedConfigs(): array
    {
        return [
            'an unknown key' => ["bogus: 1\n", ['config.schema']],
            'a missing required key' => ["targets:\n  - { use: seampact/laravel, api: tasks }\n", ['config.schema']],
            'api and apis together' => ["targets:\n  - { id: a, use: seampact/laravel, api: t, apis: [t] }\n", ['config.schema']],
            'a YAML syntax error' => ["targets: [\n", ['config.yaml.syntax']],
            'a duplicate key' => ["outDir: a\noutDir: b\n", ['config.yaml.syntax']],
            'a custom tag' => ["outDir: !php/const PHP_EOL\n", ['config.yaml.syntax']],
            'a merge key' => ["base: &b { id: a }\ntargets:\n  - <<: *b\n", ['config.yaml.syntax']],
            'a reserved key' => ["sources:\n  __proto__: { path: x }\n", ['config.key.reserved']],
            'an unquoted date' => ["outDir: 2026-10-26\n", ['config.yaml.date']],
            'a root config' => ["apps: [a]\n", ['config.root.not-an-app']],
            'a duplicate entry id' => [
                "openapi: none\ntargets:\n  - { id: a, use: x/y, api: t, out: one }\n  - { id: a, use: x/z, api: t, out: two }\n",
                ['config.target.duplicate-id'],
            ],
            'an out outside outDir' => ["targets:\n  - { id: a, use: x/y, api: t, out: ../elsewhere }\n", ['config.out.outside']],
            'overlapping outs' => [
                "targets:\n  - { id: a, use: x/y, api: t, out: one }\n  - { id: b, use: x/z, api: t, out: one/inner }\n",
                ['config.out.overlap'],
            ],
            'a waiting key' => ["targets:\n  - { id: a, use: x/y, api: t, mount: /api }\n", ['config.key.waits']],
            'an allow-list switched off' => [
                "targets:\n  - id: a\n    use: x/y\n    api: t\n    artefacts: { bootCheck: false }\n    frameworkRoutes: [{ path: /up, reason: health }]\n",
                ['config.key.conflict'],
            ],
        ];
    }

    /** @param list<string> $codes */
    #[DataProvider('refusedConfigs')]
    public function testRefusesByName(string $yaml, array $codes): void
    {
        $problems = $this->read($yaml);

        self::assertIsArray($problems);
        self::assertSame($codes, array_values(array_unique(array_map(static fn (ConfigProblem $problem): string => $problem->code, $problems))));
    }

    public function testNamesTheUnknownKeyAndItsPlace(): void
    {
        $problems = $this->read("targets:\n  - { id: a, use: x/y, api: t, colour: red }\n");

        self::assertIsArray($problems);
        self::assertSame("'colour' is not a key the app config takes here.", $problems[0]->message);
        self::assertSame('app/seampact.config.yaml targets[0].colour', $problems[0]->where);
    }

    public function testRefusesAMissingFile(): void
    {
        $problems = AppConfigReader::readFile("{$this->project}/missing/seampact.config.yaml");

        self::assertIsArray($problems);
        self::assertSame('config.file.missing', $problems[0]->code);
    }

    public function testRefusesARootConfigThatListsTheApp(): void
    {
        TemporaryDirectory::write($this->project, 'seampact.config.yaml', "apps: [app]\n");

        $problems = $this->read("outDir: generated\n");

        self::assertIsArray($problems);
        self::assertSame(['config.root.unsupported'], array_map(static fn (ConfigProblem $problem): string => $problem->code, $problems));
    }

    public function testLeavesAnAppARootConfigDoesNotList(): void
    {
        TemporaryDirectory::write($this->project, 'seampact.config.yaml', "apps: [other]\n");

        self::assertInstanceOf(AppConfig::class, $this->read("outDir: generated\n"));
    }

    public function testRefusesLocalSourcesWhenTheConfigOrTheEnvironmentSaysSo(): void
    {
        self::assertSame(LocalSourcePolicy::Allow, LocalSourcePolicy::of(null, []));
        self::assertSame(LocalSourcePolicy::Refuse, LocalSourcePolicy::of(false, []));
        self::assertSame(LocalSourcePolicy::Refuse, LocalSourcePolicy::of(true, [LocalSourcePolicy::ALLOW_LOCAL_VARIABLE => 'false']));
        self::assertSame(LocalSourcePolicy::Refuse, LocalSourcePolicy::of(false, [LocalSourcePolicy::ALLOW_LOCAL_VARIABLE => 'true']));
        self::assertSame('SEAMPACT_ALLOW_LOCAL=false', LocalSourcePolicy::refusalReason([LocalSourcePolicy::ALLOW_LOCAL_VARIABLE => 'false']));
    }

    /** @return AppConfig|list<ConfigProblem> */
    private function read(string $yaml): AppConfig|array
    {
        TemporaryDirectory::write($this->project, 'app/seampact.config.yaml', $yaml);

        return AppConfigReader::readFile("{$this->project}/app/seampact.config.yaml", 'app/seampact.config.yaml');
    }
}
