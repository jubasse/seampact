<?php

declare(strict_types=1);

/**
 * Turns an assembled Symfony consumer into the API Platform consumer (ADR 0029 "The consumer and the proof"): the same
 * controllers, hook doubles and security setup, served through API Platform's routes instead of the route loaders.
 * `php derive.php <app> <repository-root>`; every edit must apply, or the Symfony consumer changed under it.
 */
const KERNEL_EDITS = [
    'yield new SecurityBundle();' => "yield new SecurityBundle();\n        yield new \\ApiPlatform\\Symfony\\Bundle\\ApiPlatformBundle();",
    "            'validation' => ['enabled' => true],\n" => "            'validation' => ['enabled' => true],\n            'serializer' => ['enabled' => true],\n            'property_info' => ['enabled' => true],\n",
    '        // Read at run time, so one container serves every responses mode.' => "        \$container->extension('api_platform', [\n            'title' => 'Seampact suite',\n            'version' => '1.0.0',\n            'mapping' => ['paths' => [__DIR__ . '/Generated']],\n            'defaults' => ['stateless' => true],\n            'enable_swagger_ui' => false,\n            'enable_re_doc' => false,\n        ]);\n        // Read at run time, so one container serves every responses mode.",
];
const ROUTE_IMPORTS_FROM = '        // The mount-mismatch boot variant imports';
const ROUTE_IMPORTS_TO = '        // The suite\'s control routes';
const API_PLATFORM_ROUTES = "        // API Platform registers each generated operation as a route; no route loader is imported.\n        \$routes->import('.', 'api_platform');\n\n";

function applied(string $source, string $search, string $replacement): string
{
    if (substr_count($source, $search) !== 1) {
        throw new RuntimeException("derive.php: the Symfony consumer no longer holds exactly one '" . strtok($search, "\n") . "'.");
    }

    return str_replace($search, $replacement, $source);
}

function withoutRouteImports(string $kernel): string
{
    $from = strpos($kernel, ROUTE_IMPORTS_FROM);
    $to = strpos($kernel, ROUTE_IMPORTS_TO);
    if ($from === false || $to === false || $to < $from) {
        throw new RuntimeException('derive.php: the Symfony consumer no longer imports its route loaders where it did.');
    }

    return substr($kernel, 0, $from) . API_PLATFORM_ROUTES . substr($kernel, $to);
}

[, $app, $repository] = $argv + [null, null, null];
if (!is_string($app) || !is_string($repository)) {
    fwrite(STDERR, "usage: php derive.php <app> <repository-root>\n");
    exit(1);
}

$kernelFile = "{$app}/src/Kernel.php";
$kernel = withoutRouteImports((string) file_get_contents($kernelFile));
foreach (KERNEL_EDITS as $search => $replacement) {
    $kernel = applied($kernel, $search, $replacement);
}
file_put_contents($kernelFile, $kernel);

$configFile = "{$app}/seampact.config.yaml";
file_put_contents($configFile, str_replace('use: seampact/symfony', 'use: seampact/api-platform', (string) file_get_contents($configFile)));

$composerFile = "{$app}/composer.json";
$composer = json_decode((string) file_get_contents($composerFile), true, 512, JSON_THROW_ON_ERROR);
$symfonyConstraint = $composer['require']['symfony/framework-bundle'];
$composer['require'] += [
    'api-platform/symfony' => '^5.0',
    'seampact/api-platform' => 'dev-develop',
    'symfony/expression-language' => $symfonyConstraint,
    'symfony/property-access' => $symfonyConstraint,
    'symfony/property-info' => $symfonyConstraint,
    'symfony/serializer' => $symfonyConstraint,
];
ksort($composer['require']);
$composer['repositories'][] = [
    'type' => 'path',
    'url' => "{$repository}/php/api-platform",
    'options' => ['symlink' => false, 'versions' => ['seampact/api-platform' => 'dev-develop']],
];
file_put_contents($composerFile, json_encode($composer, JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
