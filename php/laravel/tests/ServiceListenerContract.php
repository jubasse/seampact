<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Seampact\Codegen\Runtime\RuntimeVersion;

/** A generated contract class of the api 'service' with no operation, naming its unexpected-error listener interface. */
final class ServiceListenerContract
{
    public const API = 'service';
    public const GENERATED_BY = RuntimeVersion::VERSION;
    public const IR = ['operations' => []];
    public const TYPES = ['unexpectedErrorListener' => ServiceUnexpectedErrorListener::class];
    public const ROUTES_CLASS = DeniedStatusRoutes::class;
    public const FRAMEWORK_ROUTES = [];
    public const FRAMEWORK_ROUTE_SCOPE = 'contract';
    public const MOUNT = '';
}
