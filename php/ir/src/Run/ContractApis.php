<?php

declare(strict_types=1);

namespace Seampact\Ir\Run;

use Seampact\Ir\Binary\BinaryFailure;
use Seampact\Ir\Binary\BinaryRefusedException;
use Seampact\Ir\Binary\BinaryRunner;
use Seampact\Ir\Binary\CompilerBinary;
use Seampact\Ir\Binary\HostPlatform;
use Seampact\Ir\Binary\InstalledBinary;
use Seampact\Ir\Binary\RootPackage;
use Seampact\Ir\Bundle\BundleFailure;
use Seampact\Ir\Bundle\BundleFetcher;
use Seampact\Ir\Bundle\BundleSource;
use Seampact\Ir\Bundle\FetchedBundle;
use Seampact\Ir\Bundle\PrivateDirectory;
use Seampact\Ir\Config\AppConfig;
use Seampact\Ir\Config\ConfigProblem;
use Seampact\Ir\Config\LocalSource;
use Seampact\Ir\Config\LocalSourcePolicy;
use Seampact\Ir\Config\SourceApi;
use Seampact\Ir\Config\WorkspaceApiNames;

/**
 * Gets the IR of each source the PHP entries use (ADR 0010 "How a native plugin gets the IR"): a bundle source
 * through its channel and the pinned-bundle check, a `path` source compiled by the pinned binary, installed only when
 * such a source or the documents need it. Every source is tried, so one run names every problem.
 */
final class ContractApis
{
    private const COMPILE_ENTRY_ID = 'compile';

    private const COMPILE_PREFIX = 'seampact-source-';

    private InstalledBinary|BinaryFailure|null $binary = null;

    /** @var list<array{string, string}> each bundle source that passed the check, with its integrity */
    public array $checkedBundles = [];

    /** @param array<string, string> $environment */
    public function __construct(
        private readonly BundleFetcher $fetcher,
        private readonly LocalSourcePolicy $localSources,
        private readonly RootPackage $root,
        private readonly string $vendorDirectory,
        private readonly array $environment,
    ) {
    }

    /**
     * @param list<string> $used the sources the entries use
     * @return list<SourceApi>|list<ConfigProblem>
     */
    public function read(AppConfig $config, array $used): array
    {
        $apis = [];
        $problems = [];

        foreach ($used as $name) {
            $source = $config->sources[$name];
            $read = $source instanceof LocalSource
                ? $this->compiled($name, $source)
                : $this->fetched($name, $source, $config->directory);

            foreach ($read as $item) {
                if ($item instanceof SourceApi) {
                    $apis[] = $item;
                } else {
                    $problems[] = $item;
                }
            }
        }

        return $problems === [] ? $apis : $problems;
    }

    /** @return list<SourceApi|ConfigProblem> */
    private function fetched(string $name, BundleSource $source, string $directory): array
    {
        $fetched = $this->fetcher->fetch($source, $directory, $this->localSources);
        if (!$fetched instanceof FetchedBundle) {
            return array_map(static fn (BundleFailure $failure): ConfigProblem => RunProblems::ofBundle($failure, $name), $fetched);
        }

        $this->checkedBundles[] = [$name, $fetched->integrity];
        $apis = [];
        foreach ($fetched->irDocuments as $api => $document) {
            $apis[] = new SourceApi($name, (string) $api, $document);
        }

        return $apis;
    }

    /**
     * The refusal of each `path` source among `$names` that local sources are refused for, without compiling it:
     * the sources only the binary's documents run compiles, which gets no `SEAMPACT_ALLOW_LOCAL`.
     *
     * @param list<string> $names
     * @return list<ConfigProblem>
     */
    public function localRefusals(AppConfig $config, array $names): array
    {
        $problems = [];
        foreach ($names as $name) {
            $source = $config->sources[$name];
            $refused = $source instanceof LocalSource ? $this->localRefusal($name, $source) : null;
            if ($refused !== null) {
                $problems[] = $refused;
            }
        }

        return $problems;
    }

    private function localRefusal(string $name, LocalSource $source): ?ConfigProblem
    {
        if ($this->localSources !== LocalSourcePolicy::Refuse) {
            return null;
        }

        return new ConfigProblem(
            'config.source.local',
            "The source '{$name}' is a local path ({$source->directory}), and local sources are refused here (" . LocalSourcePolicy::refusalReason($this->environment) . ').',
            'Use a pinned bundle source instead: `{ release: { url }, integrity }` or `{ git: { url, tag, directory }, integrity }`.',
            "source '{$name}'",
        );
    }

    /** @return list<SourceApi|ConfigProblem> */
    private function compiled(string $name, LocalSource $source): array
    {
        $where = "source '{$name}'";

        $refused = $this->localRefusal($name, $source);
        if ($refused !== null) {
            return [$refused];
        }

        $binary = $this->binary();
        if ($binary instanceof BinaryFailure) {
            return [RunProblems::ofBinary($binary, $where)];
        }

        $apiNames = WorkspaceApiNames::of($source->directory);
        $workDirectory = PrivateDirectory::create(sys_get_temp_dir(), self::COMPILE_PREFIX);

        try {
            $configFile = $workDirectory . '/seampact.config.yaml';
            file_put_contents($configFile, self::compileConfig($name, $source->directory));
            $output = BinaryRunner::compile($binary, $configFile, $apiNames ?? [], BinaryRunner::DEADLINE_SECONDS, $this->environment, PHP_OS_FAMILY === 'Windows');
        } catch (BinaryRefusedException $refused) {
            return [RunProblems::ofBinary($refused->failure, $where)];
        } finally {
            PrivateDirectory::remove($workDirectory);
        }

        if ($apiNames === null) {
            return [new ConfigProblem(
                'config.source.apis-unread',
                "The source '{$name}' compiled, but its api names cannot be read from its `workspace.yaml` or `api.yaml`.",
                'List the apis under `workspace.apis` in the workspace.yaml of the source.',
                $where,
            )];
        }

        $apis = [];
        foreach ($output->irTextByApi as $api => $irText) {
            $document = json_decode($irText, false);
            if (!$document instanceof \stdClass) {
                return [new ConfigProblem('binary.ir-unreadable', "The IR of the api '{$api}' is not a JSON object.", 'Report the binary version: its IR does not read.', $where)];
            }
            $apis[] = new SourceApi($name, (string) $api, $document);
        }

        return $apis;
    }

    /**
     * The checked cache entry of each bundle source this run read, by source name, for the binary's documents run;
     * and the problems of the entries that are gone or changed since.
     *
     * @return array{array<string, string>, list<ConfigProblem>}
     */
    public function handedBundles(): array
    {
        $directories = [];
        $problems = [];

        foreach ($this->checkedBundles as [$name, $integrity]) {
            $entry = $this->fetcher->verifiedCacheEntry($integrity);
            if ($entry instanceof BundleFailure) {
                $problems[] = RunProblems::ofBundle($entry, $name);
            } else {
                $directories[$name] = $entry;
            }
        }

        return [$directories, $problems];
    }

    // The binary is installed once, on the first `path` source or the documents, and only then (ADR 0010 "Lazy").
    public function binary(): InstalledBinary|BinaryFailure
    {
        if ($this->binary === null) {
            try {
                $this->binary = CompilerBinary::install($this->root, $this->vendorDirectory, HostPlatform::current(), $this->environment);
            } catch (BinaryRefusedException $refused) {
                $this->binary = $refused->failure;
            }
        }

        return $this->binary;
    }

    // The binary compiles the sources its config's entries name: one source, named by one entry, and no document, so
    // a run never fetches a bundle source or writes anything but the IR. JSON is YAML.
    private static function compileConfig(string $name, string $directory): string
    {
        return json_encode([
            'sources' => [$name => ['path' => $directory]],
            'targets' => [['id' => self::COMPILE_ENTRY_ID, 'use' => 'seampact/ir', 'api' => "{$name}/{$name}"]],
            'openapi' => 'none',
        ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES) . "\n";
    }
}
