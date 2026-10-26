<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel\Runtime;

use Illuminate\Contracts\Foundation\Application;
use Illuminate\Contracts\Http\Kernel;
use Illuminate\Http\Request;
use Seampact\Hooks\RequestView;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\MethodNotAllowedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * The api's global middleware, prepended before every other one: step 1 (the raw-path match, the query, the media
 * type, the bounded body read and its decoding) on the way in, and on the way out the route check, the mapping of a
 * native layer's refusal to its role, and step 10, the outgoing response check. It answers its own refusals in the
 * api's format, and the api's 500 on every contract request while it is not the first global middleware.
 */
abstract class BoundaryMiddleware
{
    private const NOT_FOUND_ROLE = 'notFound';
    private const NOT_FOUND_STATUS = 404;
    private const PREFLIGHT_METHOD = 'OPTIONS';

    private ?Hooks $hooks = null;

    /** @var array<class-string, true> the boundaries found first in the global stack, once per booted application */
    private static array $placed = [];

    public function __construct(protected readonly Application $app)
    {
    }

    /** The generated contract class of the api. */
    abstract protected function contractClass(): string;

    public function handle(Request $request, \Closure $next): Response
    {
        // A CORS preflight is the app's HandleCors to answer, which runs after the boundary.
        if (self::isPreflight($request)) {
            return self::passed($next($request));
        }

        $contract = ApiContract::of($this->contractClass());
        $match = $contract->match($request->getMethod(), RawTarget::path($request));
        if ($match === null) {
            return self::passed($next($request));
        }

        return $this->served($request, $next, $contract, $match)->prepare($request);
    }

    // Every reply on a contract or base path, prepared here since the boundary writes some outside the router.
    private function served(Request $request, \Closure $next, ApiContract $contract, RouteMatch $match): Response
    {
        if (!$this->isFirst()) {
            return ReplyVerdict::internalError($this->hooks(), $contract, $match->operationId, 'the boundary middleware is not the first global middleware; let the provider prepend it, and prepend no other global middleware before it', null);
        }

        $operationId = $match->operationId;
        if ($operationId === null) {
            return $this->setting($contract, null, 'catch_all') === false
                ? self::passed($next($request))
                : ReplyVerdict::roleReply($contract, null, self::NOT_FOUND_ROLE, self::NOT_FOUND_STATUS);
        }

        $state = new BoundaryState($contract, $operationId, $match->rawParameters, self::view($request), $this->hooks());
        $request->attributes->set(BoundaryState::attributeName($contract->api), $state);

        try {
            InputStep::read($request, $state);
            $response = self::passed($next($request));
        } catch (ContractRefusal $refusal) {
            return $refusal->render($request);
        } catch (\Throwable $failure) {
            return ReplyVerdict::internalError($this->hooks(), $contract, $operationId, 'the request failed before a reply was written', $failure);
        }

        return $this->checked($request, $state, $response);
    }

    private function checked(Request $request, BoundaryState $state, Response $response): Response
    {
        $contract = $state->contract;
        $exception = property_exists($response, 'exception') && $response->exception instanceof \Throwable ? $response->exception : null;

        if (self::routedElsewhere($request, $state, $exception)) {
            return $state->author(ReplyVerdict::roleReply($contract, $state->operationId, self::NOT_FOUND_ROLE, self::NOT_FOUND_STATUS));
        }

        if ($exception instanceof ContractBypassedException) {
            return ReplyVerdict::internalError($this->hooks(), $contract, $state->operationId, 'a contract FormRequest ran without the access middleware\'s mark', $exception);
        }

        if ($exception instanceof BoundaryFailure) {
            return ReplyVerdict::internalError($this->hooks(), $contract, $state->operationId, 'a boundary step failed', $exception->getPrevious() ?? $exception);
        }

        $role = $exception === null ? null : ExceptionRoles::roleOf($exception);
        if ($role !== null) {
            return ReplyVerdict::mapped($state, $response, $role, $exception, ExceptionRoles::KEPT_HEADERS);
        }

        // An exception no role maps and no contract reply rendered answers the api's 500 in every `responses` mode,
        // so Laravel's error page and its debug trace never reach the client.
        if ($exception !== null && !$state->authored($response)) {
            return ReplyVerdict::internalError($this->hooks(), $contract, $state->operationId, 'an exception reached the boundary unmapped', $exception);
        }

        return ReplyVerdict::checked(
            $state,
            $response,
            $exception,
            self::text($this->setting($contract, $state->operationId, 'responses')),
            self::text($this->setting($contract, $state->operationId, 'framework_etag')),
        );
    }

    // Once routing ran, a route other than this operation's contract route answers the raw path's 404.
    private static function routedElsewhere(Request $request, BoundaryState $state, ?\Throwable $exception): bool
    {
        $route = Services::route($request);
        if ($route !== null) {
            return $route->getName() !== $state->contract->routeName($state->operationId);
        }

        return $exception instanceof NotFoundHttpException || $exception instanceof MethodNotAllowedHttpException;
    }

    private function hooks(): Hooks
    {
        return $this->hooks ??= new Hooks($this->app);
    }

    private static function text(mixed $setting): ?string
    {
        return is_string($setting) ? $setting : null;
    }

    private static function isPreflight(Request $request): bool
    {
        return $request->getMethod() === self::PREFLIGHT_METHOD
            && $request->headers->has('Origin')
            && $request->headers->has('Access-Control-Request-Method');
    }

    /** An operation's setting: `config('seampact.<api>.operations.<id>.<name>')`, then the api's, then the default. */
    private function setting(ApiContract $contract, ?string $operationId, string $name): mixed
    {
        $config = Services::config($this->app);
        $value = $operationId === null ? null : $config->get("seampact.{$contract->api}.operations.{$operationId}.{$name}");

        return $value ?? $config->get("seampact.{$contract->api}.{$name}") ?? $contract->defaults[$name] ?? null;
    }

    // Checked on the first request of each booted application, which under php-fpm is every request.
    private function isFirst(): bool
    {
        if (isset(self::$placed[static::class])) {
            return true;
        }

        $kernel = $this->app->make(Kernel::class);
        $global = method_exists($kernel, 'getGlobalMiddleware') ? $kernel->getGlobalMiddleware() : null;
        $first = is_array($global) ? ($global[0] ?? null) : null;
        if ($first !== static::class) {
            return false;
        }
        self::$placed[static::class] = true;

        return true;
    }

    private static function view(Request $request): RequestView
    {
        $headers = [];
        foreach ($request->headers->all() as $name => $values) {
            $headers[(string) $name] = array_values(array_filter($values, is_string(...)));
        }

        return new RequestView($request->getMethod(), RawTarget::path($request), $headers, $request->server->getString('REMOTE_ADDR') ?: null);
    }

    private static function passed(mixed $response): Response
    {
        if (!$response instanceof Response) {
            throw new \LogicException('seampact: the middleware stack answered ' . get_debug_type($response) . ' instead of a Symfony response.');
        }

        return $response;
    }
}
