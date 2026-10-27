<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Seampact\Golden\Tasks\AppEndpoints;
use Seampact\Golden\Tasks\Symfony\GetTaskInputConstraint;
use Seampact\Golden\Tasks\Symfony\GetTasksBatchInputConstraint;
use Seampact\Golden\Tasks\Symfony\TasksAccess;
use Seampact\Golden\Tasks\Symfony\TasksContract;
use Seampact\Golden\Tasks\Symfony\TasksRouteLoader;
use Seampact\Golden\Tasks\Symfony\TasksRouteNames;
use Seampact\Golden\Tasks\Symfony\TasksSeampactBundle;
use Seampact\Golden\Tasks\Symfony\TasksSettings;
use Seampact\Golden\Tasks\Symfony\TasksUrls;
use Seampact\Golden\TasksConsistent\Symfony\PaymentsInputConstraint;
use Seampact\Golden\TasksConsistent\Symfony\TasksSettings as AbsoluteSettings;
use Seampact\Symfony\Runtime\Issue;
use Seampact\Symfony\Runtime\KindRequestMatcher;
use Seampact\Symfony\Tests\Support\HealthController;
use Symfony\Component\Config\Definition\Exception\InvalidConfigurationException;
use Symfony\Component\DependencyInjection\Compiler\PassConfig;
use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\DependencyInjection\Reference;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\DependencyInjection\MergeExtensionConfigurationPass;
use Symfony\Component\HttpKernel\DependencyInjection\RegisterControllerArgumentLocatorsPass;
use Symfony\Component\Routing\Generator\UrlGenerator;
use Symfony\Component\Routing\RequestContext;
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
        self::assertSame('/v1/channels/{channelId}/tasks/batch', $batch->getPath());
        self::assertSame(['POST'], $batch->getMethods());
        self::assertSame('getTasksBatch', $batch->getDefault(TasksRouteLoader::OPERATION_DEFAULT));
    }

    public function testPlaceholdersAreNamedAfterTheInputPropertiesSoTheRouterBuildsTheUrl(): void
    {
        $urls = new UrlGenerator((new TasksRouteLoader())->load('tasks', 'seampact'), new RequestContext());

        self::assertSame('/v1/channels/c1/tasks/t1', $urls->generate('seampact.tasks.getTask', ['channelId' => 'c1', 'taskId' => 't1']));
    }

    public function testEachRouteNameConstantNamesOneLoadedRoute(): void
    {
        $loaded = array_keys((new TasksRouteLoader())->load('tasks', 'seampact')->all());
        $constants = array_values((new \ReflectionClass(TasksRouteNames::class))->getConstants());
        sort($loaded);
        sort($constants);

        self::assertSame($loaded, $constants);
    }

    public function testTheUrlBuilderGivesThePathTheRouterBuilds(): void
    {
        $urls = new UrlGenerator((new TasksRouteLoader())->load('tasks', 'seampact'), new RequestContext());

        self::assertSame($urls->generate(TasksRouteNames::GET_TASK, ['channelId' => 'c1', 'taskId' => 't1']), TasksUrls::getTask('c1', 't1'));
        self::assertSame('/v1/channels/a%2Fb/tasks/%20%3F%23', TasksUrls::getTask('a/b', ' ?#'));
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

    public function testAnOpaqueMemberThatIsNotNullableRefusesNull(): void
    {
        $input = (object) [
            'path' => new \stdClass(),
            'query' => new \stdClass(),
            'header' => new \stdClass(),
            'body' => (object) ['id' => 'evt_1', 'type' => 'invoice.paid', 'data' => null],
        ];

        $issues = [];
        foreach (Validation::createValidator()->validate($input, new PaymentsInputConstraint()) as $violation) {
            $issues[] = $violation->getPropertyPath() . ' ' . Issue::ruleOf($violation);
        }

        self::assertSame(['/body/data type'], $issues);
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

        self::assertTrue($container->getDefinition(TasksSeampactBundle::ROUTE_LOADER_SERVICE)->hasTag('routing.loader'));
        $settings = new TasksSettings(...self::namedArguments($container->getDefinition(TasksSeampactBundle::SETTINGS_SERVICE)->getArguments()));
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

    /** @return iterable<string, array{array<string, mixed>, string}> */
    public static function literalTypos(): iterable
    {
        yield 'responses' => [['responses' => 'stric'], "The bundle configuration key seampact_tasks.responses takes 'strict' or 'warn'."];
        yield 'an operation\'s responses' => [['operations' => ['getTask' => ['responses' => 'stric']]], "The bundle configuration key seampact_tasks.operations.getTask.responses takes 'strict' or 'warn'."];
        yield 'body_validation' => [['body_validation' => 'maybe'], 'The bundle configuration key seampact_tasks.body_validation takes true or false.'];
    }

    /** @param array<string, mixed> $configuration */
    #[DataProvider('literalTypos')]
    public function testALiteralValueOutsideItsValuesFailsTheContainerBuild(array $configuration, string $refusal): void
    {
        $this->expectException(InvalidConfigurationException::class);
        $this->expectExceptionMessage($refusal);
        self::mergedConfiguration($configuration);
    }

    public function testAnEnvValueIsLeftToTheRunTimeCheck(): void
    {
        $container = self::mergedConfiguration(['responses' => '%env(TASKS_RESPONSES)%', 'body_validation' => '%env(TASKS_BODY_VALIDATION)%']);

        self::assertTrue($container->hasDefinition(TasksSeampactBundle::SETTINGS_SERVICE));
    }

    public function testANullPerOperationValueFallsBackToTheApisValue(): void
    {
        $container = self::mergedConfiguration(['responses' => 'warn', 'operations' => ['getTask' => ['responses' => null]]]);
        $settings = new TasksSettings(...self::namedArguments($container->getDefinition(TasksSeampactBundle::SETTINGS_SERVICE)->getArguments()));

        self::assertSame('warn', $settings->responsesOf('getTask'));
    }

    /** @param array<string, mixed> $configuration */
    private static function mergedConfiguration(array $configuration): ContainerBuilder
    {
        $extension = (new TasksSeampactBundle())->getContainerExtension();
        self::assertNotNull($extension);
        $container = new ContainerBuilder();
        $container->setParameter('kernel.environment', 'test');
        $container->setParameter('kernel.build_dir', sys_get_temp_dir());
        $container->registerExtension($extension);
        $container->loadFromExtension($extension->getAlias(), $configuration);
        (new MergeExtensionConfigurationPass([$extension->getAlias()]))->process($container);

        return $container;
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
