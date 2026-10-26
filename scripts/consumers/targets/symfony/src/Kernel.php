<?php

declare(strict_types=1);

namespace App;

use App\Controller\AppController;
use App\Controller\SuiteControlController;
use App\Controller\UnlistedRouteController;
use App\Generated\Tasks\Symfony\TasksRouteLoader;
use App\Generated\Tasks\Symfony\TasksSeampactBundle;
use App\Generated\TasksService\Symfony\TasksServiceRouteLoader;
use App\Generated\TasksService\Symfony\TasksServiceSeampactBundle;
use App\Suite\ChannelResolver;
use App\Suite\ForbiddenProbeMatcher;
use App\Suite\SuiteLogger;
use App\Suite\TasksDecider;
use App\Suite\UserHook;
use Seampact\ConsumerSuite\BootVariant;
use Seampact\ConsumerSuite\FileIdempotencyStore;
use Seampact\ConsumerSuite\SuiteFiles;
use Seampact\Hooks\IdempotencyStore;
use Symfony\Bundle\FrameworkBundle\FrameworkBundle;
use Symfony\Bundle\FrameworkBundle\Kernel\MicroKernelTrait;
use Symfony\Bundle\SecurityBundle\SecurityBundle;
use Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator;
use Symfony\Component\HttpKernel\Kernel as BaseKernel;
use Symfony\Component\Routing\Loader\Configurator\RoutingConfigurator;
use Symfony\Component\Security\Core\User\InMemoryUser;

/**
 * The consumer app: FrameworkBundle, SecurityBundle with one lazy `http_basic` firewall on the tasks api's paths, its
 * `login_throttling` and one `access_control` rule keyed on a suite header, the RateLimiter the throttle decider counts
 * in, the file idempotency store, and the bundles of the `tasks` and `tasksService` apis. The boot variant leaves out the service
 * it names and gets a cache directory of its own; `SEAMPACT_SUITE_CACHE_DIR` moves the cache for a boot run.
 */
final class Kernel extends BaseKernel
{
    use MicroKernelTrait;

    public const SUITE_USER = 'suite-user';
    public const SUITE_PASSWORD = 'suite-password';
    /** Failed `http_basic` logins of one user name a client may send per window before `login_throttling` answers 429. */
    public const LOGIN_ATTEMPTS = 3;
    private const LOGIN_WINDOW = '10 seconds';
    private const CONTROL_STATE_FILE = '/var/suite-control.json';
    private const CREDENTIALS_FILE = '/credentials.json';
    private const CACHE_VARIABLE = 'SEAMPACT_SUITE_CACHE_DIR';
    private const RESPONSES_VARIABLE = 'SEAMPACT_SUITE_RESPONSES';
    private const LEFT_OUT_BY_VARIANT = [
        'missing-authenticate-hook' => UserHook::class,
        'missing-decider' => TasksDecider::class,
        'missing-scope-resolver' => ChannelResolver::class,
        'missing-handler' => AppController::class,
    ];

    public function registerBundles(): iterable
    {
        yield new FrameworkBundle();
        yield new SecurityBundle();
        yield new TasksSeampactBundle();
        yield new TasksServiceSeampactBundle();
    }

    public function boot(): void
    {
        SuiteFiles::configure($this->getProjectDir() . self::CONTROL_STATE_FILE, $this->getProjectDir() . self::CREDENTIALS_FILE);

        parent::boot();
    }

    public function getCacheDir(): string
    {
        $cacheDirectory = getenv(self::CACHE_VARIABLE);
        if (is_string($cacheDirectory) && $cacheDirectory !== '') {
            return $cacheDirectory;
        }

        return $this->getProjectDir() . '/var/cache/' . $this->environment . '/' . (BootVariant::current() ?? 'configured');
    }

    public function getLogDir(): string
    {
        return $this->getProjectDir() . '/var/log';
    }

    private function configureContainer(ContainerConfigurator $container): void
    {
        $container->parameters()->set('seampact_suite.responses', 'strict');
        $container->extension('framework', [
            'secret' => 'seampact-suite',
            'http_method_override' => false,
            'handle_all_throwables' => true,
            'php_errors' => ['log' => true],
            'validation' => ['enabled' => true],
            'router' => ['utf8' => true],
            // One request a window: the throttle decider spends the throttled user's bucket by its first request.
            'rate_limiter' => ['suite_throttle' => ['policy' => 'fixed_window', 'limit' => 1, 'interval' => '1 hour']],
        ]);
        $container->extension('security', [
            'password_hashers' => [InMemoryUser::class => 'plaintext'],
            'providers' => ['suite_users' => ['memory' => ['users' => [self::SUITE_USER => ['password' => self::SUITE_PASSWORD, 'roles' => ['ROLE_USER']]]]]],
            'firewalls' => ['contract' => ['pattern' => '^/v1', 'lazy' => true, 'stateless' => true, 'provider' => 'suite_users', 'http_basic' => ['realm' => 'seampact suite'], 'login_throttling' => ['max_attempts' => self::LOGIN_ATTEMPTS, 'interval' => self::LOGIN_WINDOW]]],
            'access_control' => [['request_matcher' => ForbiddenProbeMatcher::class, 'roles' => ['ROLE_SUITE_ADMIN']]],
        ]);
        // Read at run time, so one container serves every responses mode.
        $container->extension('seampact_tasks', ['responses' => '%env(default:seampact_suite.responses:' . self::RESPONSES_VARIABLE . ')%']);

        $services = $container->services()->defaults()->autowire()->autoconfigure();
        $leftOut = self::LEFT_OUT_BY_VARIANT[BootVariant::current() ?? ''] ?? null;
        $services->load('App\\', __DIR__ . '/')
            ->exclude([__DIR__ . '/Generated', __DIR__ . '/Kernel.php', ...($leftOut === null ? [] : [self::sourceFileOf($leftOut)])]);
        $services->set('logger', SuiteLogger::class);
        $services->set(IdempotencyStore::class, FileIdempotencyStore::class);
    }

    private function configureRoutes(RoutingConfigurator $routes): void
    {
        $routes->import(TasksRouteLoader::RESOURCE, TasksRouteLoader::TYPE);
        $routes->import(TasksServiceRouteLoader::RESOURCE, TasksServiceRouteLoader::TYPE);

        // The suite's control routes (ADR 0015 "Control routes"), allow-listed in seampact.config.yaml.
        $routes->add('suite_script', '/__seampact/script')->methods(['PUT'])->controller([SuiteControlController::class, 'loadScript']);
        $routes->add('suite_hook_calls', '/__seampact/hook-calls')->methods(['GET'])->controller([SuiteControlController::class, 'hookCalls']);
        $routes->add('suite_log_lines', '/__seampact/log-lines')->methods(['GET'])->controller([SuiteControlController::class, 'logLines']);

        if (BootVariant::servesUnlistedRoute()) {
            $routes->add('suite_unlisted', '/v1/unlisted')->methods(['GET'])->controller(UnlistedRouteController::class);
        }
    }

    /** @param class-string $class */
    private static function sourceFileOf(string $class): string
    {
        $file = (new \ReflectionClass($class))->getFileName();
        if ($file === false) {
            throw new \LogicException("the class {$class} has no source file to leave out");
        }

        return $file;
    }
}
