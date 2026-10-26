<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Golden\Tasks\Symfony\GetTasksBatchInputConstraint;
use Seampact\Golden\Tasks\Symfony\Runtime\Issue;
use Seampact\Golden\Tasks\Symfony\TasksRouteLoader;
use Seampact\Golden\Tasks\Symfony\TasksSeampactBundle;
use Seampact\Golden\Tasks\Symfony\TasksSettings;
use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\Validator\Validation;

/** The golden tree's Symfony placement run in Symfony: its routes, its input constraint and its bundle configuration. */
final class GeneratedPlacementTest extends TestCase
{
    private const CHANNEL_ID = '6f1c2b9e-0a43-4c8e-9a51-1f2d3c4b5a69';

    public function testTheLoaderServesItsOwnApiAndRegistersALiteralSegmentBeforeAPlaceholder(): void
    {
        $loader = new TasksRouteLoader();
        self::assertTrue($loader->supports('tasks', 'seampact'));
        self::assertFalse($loader->supports('billing', 'seampact'));

        $routes = $loader->load('tasks', 'seampact');
        $names = array_keys($routes->all());
        self::assertLessThan(array_search('seampact.tasks.getTask', $names, true), array_search('seampact.tasks.getTasksBatch', $names, true));

        $batch = $routes->get('seampact.tasks.getTasksBatch');
        self::assertNotNull($batch);
        self::assertSame('/v1/channels/{p1}/tasks/batch', $batch->getPath());
        self::assertSame(['POST'], $batch->getMethods());
        self::assertSame('getTasksBatch', $batch->getDefault(TasksRouteLoader::OPERATION_DEFAULT));
    }

    public function testTheInputConstraintReportsEachIssueWithItsRuleAndPointer(): void
    {
        $ids = array_fill(0, 201, self::CHANNEL_ID);
        $ids[3] = '';
        $input = (object) [
            'path' => (object) ['channelId' => 'not-a-uuid'],
            'query' => (object) ['page' => '2'],
            'header' => new \stdClass(),
            'body' => (object) ['ids' => $ids, 'extra' => true],
        ];

        $issues = [];
        foreach (Validation::createValidator()->validate($input, new GetTasksBatchInputConstraint()) as $violation) {
            $issues[] = $violation->getPropertyPath() . ' ' . Issue::ruleOf($violation);
        }
        sort($issues);

        self::assertSame(['/body/extra unknownKeys', '/body/ids maxItems', '/body/ids/3 format', '/path/channelId format', '/query/page unknownKeys'], $issues);
    }

    public function testTheBundleConfiguresItsServicesUnderItsAliasWithTheTargetDefaults(): void
    {
        $bundle = new TasksSeampactBundle();
        $extension = $bundle->getContainerExtension();
        self::assertNotNull($extension);
        self::assertSame('seampact_tasks', $extension->getAlias());

        $container = new ContainerBuilder();
        $container->setParameter('kernel.environment', 'test');
        $container->setParameter('kernel.build_dir', sys_get_temp_dir());
        $extension->load([['operations' => ['getTask' => ['responses' => 'warn']]]], $container);

        self::assertTrue($container->getDefinition(TasksRouteLoader::class)->hasTag('routing.loader'));
        $settings = new TasksSettings(...$container->getDefinition(TasksSettings::class)->getArguments());
        self::assertSame('warn', $settings->responsesOf('getTask'));
        self::assertSame('strict', $settings->responsesOf('getDraft'));
        self::assertFalse($settings->bodyValidation());
    }

    public function testASettingOutsideItsValuesIsRefusedNamingItsKeyNeverItsValue(): void
    {
        $settings = new TasksSettings('loud', 'maybe', []);

        try {
            $settings->responsesOf('getTask');
            self::fail('An unknown responses mode was read.');
        } catch (\UnexpectedValueException $refused) {
            self::assertSame("The bundle configuration key seampact_tasks.responses takes 'strict' or 'warn'.", $refused->getMessage());
        }

        $this->expectExceptionMessage('seampact_tasks.body_validation takes true or false');
        $settings->bodyValidation();
    }
}
