<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Golden\Tasks\AppEndpoints;
use Seampact\Golden\Tasks\Symfony\GetTaskInputConstraint;
use Seampact\Golden\Tasks\Symfony\GetTasksBatchInputConstraint;
use Seampact\Golden\Tasks\Symfony\Runtime\Issue;
use Seampact\Golden\Tasks\Symfony\Runtime\KindRequestMatcher;
use Seampact\Golden\Tasks\Symfony\TasksAccess;
use Seampact\Golden\Tasks\Symfony\TasksContract;
use Seampact\Golden\Tasks\Symfony\TasksRouteLoader;
use Seampact\Golden\Tasks\Symfony\TasksSeampactBundle;
use Seampact\Golden\Tasks\Symfony\TasksSettings;
use Seampact\Golden\TasksConsistent\Symfony\TasksSettings as AbsoluteSettings;
use Seampact\Symfony\Tests\Support\HealthController;
use Symfony\Component\Config\Definition\Exception\InvalidConfigurationException;
use Symfony\Component\DependencyInjection\Compiler\PassConfig;
use Symfony\Component\HttpKernel\DependencyInjection\RegisterControllerArgumentLocatorsPass;
use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\DependencyInjection\Reference;
use Symfony\Component\HttpFoundation\Request;
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
        $settings = new TasksSettings(...self::namedArguments($container->getDefinition(TasksSettings::class)->getArguments()));
        self::assertSame('warn', $settings->responsesOf('getTask'));
        self::assertSame('strict', $settings->responsesOf('getDraft'));
        self::assertFalse($settings->bodyValidation());
        self::assertNull($settings->publicOrigin());
    }

    public function testEachAccessKindHasARequestMatcherServiceThatMatchesOnlyItsOperations(): void
    {
        $container = new ContainerBuilder();
        $container->setParameter('kernel.environment', 'test');
        $container->setParameter('kernel.build_dir', sys_get_temp_dir());
        $extension = (new TasksSeampactBundle())->getContainerExtension();
        self::assertNotNull($extension);
        $extension->load([], $container);

        $matchers = [];
        foreach (['public', 'optional', 'identity', 'signed'] as $kind) {
            $definition = $container->getDefinition("seampact.tasks.matcher.{$kind}");
            self::assertSame(KindRequestMatcher::class, $definition->getClass());
            self::assertSame([TasksContract::class, TasksAccess::ROUTES, $kind], $definition->getArguments());
            $matchers[$kind] = new KindRequestMatcher(TasksContract::class, TasksAccess::ROUTES, $kind);
        }
        $matchedKinds = static fn (Request $request): array => array_keys(array_filter($matchers, static fn (KindRequestMatcher $matcher): bool => $matcher->matches($request)));

        self::assertSame(['public'], $matchedKinds(Request::create('/v1/health')));
        self::assertSame(['identity'], $matchedKinds(Request::create('/v1/channels/10000000-0000-4000-8000-000000000001')));
        self::assertSame([], $matchedKinds(Request::create('/v1/no-such-operation')));
        self::assertSame([], $matchedKinds(Request::create('/elsewhere')));
        self::assertSame('identity', TasksAccess::ROUTES['seampact.tasks.getTask']['kind']);
        self::assertSame('user', TasksAccess::ROUTES['seampact.tasks.getTask']['identity']);
    }

    public function testUnderAbsoluteUrlsThePublicOriginIsReadAndCheckedNamingItsKeyNeverItsValue(): void
    {
        self::assertSame('https://api.example.com', (new AbsoluteSettings('strict', false, [], 'https://api.example.com'))->publicOrigin());

        $this->expectExceptionMessage('The bundle configuration key seampact_tasks.public_origin takes the origin clients call');
        (new AbsoluteSettings('strict', false, [], 'https://api.example.com/v1'))->publicOrigin();
    }

    /**
     * The service arguments, keyed by parameter name without its `$`, as PHP's named arguments take them.
     *
     * @param array<int|string, mixed> $arguments
     * @return array<int|string, mixed>
     */
    private static function namedArguments(array $arguments): array
    {
        $named = [];
        foreach ($arguments as $key => $value) {
            $named[is_string($key) ? ltrim($key, '$') : $key] = $value;
        }

        return $named;
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

    public function testANativeUuidTakesEveryRfc9562TextTheContractTakes(): void
    {
        $issues = [];
        foreach (['6f1c2b9e-0a43-02d3-9a51-1f2d3c4b5a69', '6f1c2b9e-0a43-92d3-c456-1f2d3c4b5a69', '00000000-0000-0000-0000-000000000000'] as $taskId) {
            $input = (object) ['path' => (object) ['channelId' => self::CHANNEL_ID, 'taskId' => $taskId], 'query' => new \stdClass(), 'header' => new \stdClass()];
            foreach (Validation::createValidator()->validate($input, new GetTaskInputConstraint()) as $violation) {
                $issues[] = $violation->getPropertyPath() . ' ' . Issue::ruleOf($violation);
            }
        }

        self::assertSame([], $issues);
    }

    public function testAnUnknownOperationIdInTheConfigurationFailsTheContainerBuild(): void
    {
        $extension = (new TasksSeampactBundle())->getContainerExtension();
        self::assertNotNull($extension);
        $container = new ContainerBuilder();
        $container->setParameter('kernel.environment', 'test');
        $container->setParameter('kernel.build_dir', sys_get_temp_dir());

        $this->expectException(InvalidConfigurationException::class);
        $this->expectExceptionMessageMatches("/'getTaks'.*'getTask'/");
        $extension->load([['operations' => ['getTaks' => ['responses' => 'warn']]]], $container);
    }

    public function testTheControllerPassRunsBeforeTheControllerLocatorIsBuilt(): void
    {
        $container = new ContainerBuilder();
        $container->register(HealthController::class, HealthController::class);
        $container->register('argument_resolver.service')->setArguments([null]);
        (new TasksSeampactBundle())->build($container);
        // FrameworkBundle registers the locator pass at the default priority of this pass type.
        $container->addCompilerPass(new RegisterControllerArgumentLocatorsPass(), PassConfig::TYPE_BEFORE_OPTIMIZATION);
        foreach ($container->getCompilerPassConfig()->getBeforeOptimizationPasses() as $pass) {
            $pass->process($container);
        }

        $locatorReference = $container->getDefinition('argument_resolver.service')->getArgument(0);
        self::assertInstanceOf(Reference::class, $locatorReference);
        $controllers = $container->getDefinition((string) $locatorReference)->getArgument(0);
        self::assertIsArray($controllers);
        self::assertArrayHasKey(AppEndpoints::class . '::health', $controllers);
        self::assertTrue($container->getAlias(AppEndpoints::class)->isPublic());
    }
}
