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
