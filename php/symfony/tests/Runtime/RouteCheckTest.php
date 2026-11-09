<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests\Runtime;

use PHPUnit\Framework\TestCase;
use Seampact\Symfony\Runtime\RouteCheck;
use Seampact\Symfony\Tests\CatchAllAllowListContract;
use Symfony\Component\Config\Loader\LoaderInterface;
use Symfony\Component\Config\Loader\LoaderResolver;
use Symfony\Component\Config\Loader\LoaderResolverInterface;
use Symfony\Component\Routing\Route;
use Symfony\Component\Routing\RouteCollection;

/** The route check's reading of the app routes the entry's `frameworkRoutes` allow-lists. */
final class RouteCheckTest extends TestCase
{
    private const ROUTING_RESOURCE = 'seampact_tasks';

    public function testACatchAllRouteIsAllowListedByTwoStarsOnlyNeverByOneStar(): void
    {
        $routes = new RouteCollection();
        $routes->add('app_files', new Route('/v1/files/{path}', ['_controller' => 'App\\FilesController'], ['path' => '.+']));
        $routes->add('app_docs', new Route('/v1/docs/{path}', ['_controller' => 'App\\DocsController'], ['path' => '.+']));
        $check = new RouteCheck(self::loaderOf($routes), CatchAllAllowListContract::class, self::ROUTING_RESOURCE, true);

        $problems = '';
        try {
            $check->load(self::ROUTING_RESOURCE);
        } catch (\LogicException $failure) {
            $problems = $failure->getMessage();
        }

        self::assertStringContainsString("the app route 'app_files' (/v1/files/{path}) is not a contract route", $problems);
        self::assertStringNotContainsString('app_docs', $problems);
    }

    public function testAFrameworkControllerTheTargetListsIsAcceptedAndAnotherIsNot(): void
    {
        $routes = new RouteCollection();
        $routes->add('api_doc', new Route('/v1/docs.{_format}', ['_controller' => 'api_platform.action.documentation']));
        $routes->add('api_errors', new Route('/v1/errors/{status}', ['_controller' => 'api_platform.action.not_exposed']));
        $routes->add('api_context', new Route('/v1/contexts/{shortName}', ['_controller' => 'api_platform.jsonld.action.context']));
        $routes->add('_api_/v1/widgets_get', new Route('/v1/widgets', ['_controller' => 'api_platform.action.placeholder']));
        $controllers = ['api_platform.action.documentation', 'api_platform.action.not_exposed', 'api_platform.jsonld.action.context'];
        $check = new RouteCheck(self::loaderOf($routes), CatchAllAllowListContract::class, self::ROUTING_RESOURCE, true, $controllers);

        $problems = '';
        try {
            $check->load(self::ROUTING_RESOURCE);
        } catch (\LogicException $failure) {
            $problems = $failure->getMessage();
        }

        self::assertStringContainsString("the app route '_api_/v1/widgets_get'", $problems);
        self::assertStringNotContainsString('api_doc', $problems);
        self::assertStringNotContainsString('api_errors', $problems);
        self::assertStringNotContainsString('api_context', $problems);
    }

    public function testPlainSymfonyListsNoFrameworkControllerSoApiPlatformsRouteIsRefused(): void
    {
        $routes = new RouteCollection();
        $routes->add('api_doc', new Route('/v1/docs.{_format}', ['_controller' => 'api_platform.action.documentation']));
        $check = new RouteCheck(self::loaderOf($routes), CatchAllAllowListContract::class, self::ROUTING_RESOURCE, true);

        $this->expectException(\LogicException::class);
        $this->expectExceptionMessage("the app route 'api_doc'");

        $check->load(self::ROUTING_RESOURCE);
    }

    public function testARouteWithAnOptionalPlaceholderIsAllowListedOnlyWhenThePathWithoutItIsListedToo(): void
    {
        $routes = new RouteCollection();
        $routes->add('app_file', new Route('/v1/files/{name}', ['_controller' => 'App\\FilesController', 'name' => null]));
        $routes->add('app_file_by_id', new Route('/v1/files/{id}', ['_controller' => 'App\\FilesController']));
        $routes->add('app_doc', new Route('/v1/docs/{name?}', ['_controller' => 'App\\DocsController']));
        $check = new RouteCheck(self::loaderOf($routes), CatchAllAllowListContract::class, self::ROUTING_RESOURCE, true);

        $problems = '';
        try {
            $check->load(self::ROUTING_RESOURCE);
        } catch (\LogicException $failure) {
            $problems = $failure->getMessage();
        }

        self::assertStringContainsString("the app route 'app_file' (/v1/files/{name}) is not a contract route", $problems);
        self::assertStringContainsString('and one with an optional parameter only by entries that also take its path without it', $problems);
        self::assertStringNotContainsString('app_file_by_id', $problems, 'a required placeholder stays one segment');
        self::assertStringNotContainsString('app_doc', $problems);
    }

    private static function loaderOf(RouteCollection $routes): LoaderInterface
    {
        return new class ($routes) implements LoaderInterface {
            private LoaderResolverInterface $resolver;

            public function __construct(private readonly RouteCollection $routes)
            {
                $this->resolver = new LoaderResolver();
            }

            public function load(mixed $resource, ?string $type = null): mixed
            {
                return $this->routes;
            }

            public function supports(mixed $resource, ?string $type = null): bool
            {
                return true;
            }

            public function getResolver(): LoaderResolverInterface
            {
                return $this->resolver;
            }

            public function setResolver(LoaderResolverInterface $resolver): void
            {
                $this->resolver = $resolver;
            }
        };
    }
}
