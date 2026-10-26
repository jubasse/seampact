<?php

declare(strict_types=1);

namespace Seampact\Symfony\Runtime;

use Seampact\Codegen\Runtime\AccessSteps;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\BoundaryFailure;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\ContractBypassedException;
use Seampact\Codegen\Runtime\ContractRefusal;
use Seampact\Codegen\Runtime\DecodedInput;
use Seampact\Codegen\Runtime\HookLookup;
use Seampact\Codegen\Runtime\InputDecoding;
use Seampact\Codegen\Runtime\RawTarget;
use Seampact\Codegen\Runtime\Replies;
use Seampact\Codegen\Runtime\ReplyVerdict;
use Seampact\Codegen\Runtime\TypedInput;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Event\ControllerEvent;
use Symfony\Component\HttpKernel\Event\ExceptionEvent;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Component\HttpKernel\Event\ViewEvent;
use Symfony\Component\HttpKernel\Exception\MethodNotAllowedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\HttpKernel\KernelEvents;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\Validator\ValidatorInterface;

/**
 * The api's boundary (ADR 0024 "Placement"): step 1 before the router and the firewall, the routed marker, steps 2 to
 * 8 once the controller is known, the reply of a generated result, the rendering of the boundary's own refusals and of
 * the generated exceptions, the record of the request's first exception, and on the way out the route check, the
 * mapping of a native layer's refusal to its role and step 10. A boundary failure and an exception no role maps answer
 * the api's 500 in every `responses` mode, without Symfony's error page.
 */
abstract class BoundarySubscriber implements EventSubscriberInterface
{
    public const REQUEST_PRIORITY = 512;
    public const ROUTED_PRIORITY = 31;
    public const CONTROLLER_PRIORITY = 0;
    public const VIEW_PRIORITY = 0;
    public const FIRST_EXCEPTION_PRIORITY = 2048;
    public const EXCEPTION_PRIORITY = 128;
    /** After the app's own `kernel.exception` listeners, before Symfony's `ErrorListener` at -128. */
    public const UNMAPPED_EXCEPTION_PRIORITY = -64;
    public const LOGIN_FAILURE_PRIORITY = -2048;
    public const RESPONSE_PRIORITY = -2048;
    public const LOGIN_FAILURE_EVENT = 'Symfony\\Component\\Security\\Http\\Event\\LoginFailureEvent';
    public const MAX_RENDERED_ISSUES = 100;
    public const WORKER_REFUSAL = 'runtime.worker.unsupported';
    private const WORKER_PARAMETER = 'kernel.runtime_mode.worker';
    private const ROUTE_ATTRIBUTE = '_route';
    private const OPERATION_DEFAULT = '_seampact_operation';
    private const NOT_FOUND_ROLE = 'notFound';
    private const NOT_FOUND_STATUS = 404;
    private const UNAUTHENTICATED_ROLE = 'unauthenticated';
    private const FORBIDDEN_ROLE = 'forbidden';
    private const PARTS = ['path', 'query', 'header', 'body'];

    private int $mainRequests = 0;
    /** @var list<string>|null the hook problems, read once per container instance */
    private ?array $hookProblems = null;

    public function __construct(
        private readonly HookLookup $hooks,
        private readonly ContractSettings $settings,
        private readonly ValidatorInterface $validator,
    ) {
    }

    /** The generated contract class of the api. */
    abstract protected function contractClass(): string;

    /** The generated input constraint of an operation. */
    abstract protected function inputConstraint(string $operationId): Constraint;

    /** The request attribute the input resolver reads the typed input from. */
    abstract protected function inputAttribute(): string;

    /** The api's generated exception base, which the handlers throw. */
    abstract protected function contractExceptionClass(): string;

    /** Whether the boot check's hook problems are read, on the first contract request of each container instance. */
    abstract protected function checksHooks(): bool;

    /**
     * The bundle's `boot()` guard: a worker runtime that declares itself (`APP_RUNTIME_MODE` with `worker=1`, as
     * FrankenPHP's worker runner sets it) never finishes booting the kernel.
     */
    public static function refuseWorker(?ContainerInterface $container): void
    {
        if ($container !== null && $container->hasParameter(self::WORKER_PARAMETER) && $container->getParameter(self::WORKER_PARAMETER)) {
            throw new \LogicException(self::WORKER_REFUSAL . ": seampact does not serve from a worker runtime, which serves many requests from one container; serve the app with php-fpm, or keep this api's bundle out of the worker app.");
        }
    }

    /** @return array<string, list<array{string, int}>> */
    public static function getSubscribedEvents(): array
    {
        return [
            KernelEvents::REQUEST => [['onRequest', self::REQUEST_PRIORITY], ['onRouted', self::ROUTED_PRIORITY]],
            KernelEvents::CONTROLLER => [['onController', self::CONTROLLER_PRIORITY]],
            KernelEvents::VIEW => [['onView', self::VIEW_PRIORITY]],
            KernelEvents::EXCEPTION => [['onFirstException', self::FIRST_EXCEPTION_PRIORITY], ['onException', self::EXCEPTION_PRIORITY], ['onUnmappedException', self::UNMAPPED_EXCEPTION_PRIORITY]],
            self::LOGIN_FAILURE_EVENT => [['onLoginFailure', self::LOGIN_FAILURE_PRIORITY]],
            KernelEvents::RESPONSE => [['onResponse', self::RESPONSE_PRIORITY]],
        ];
    }

    /** Step 1, on the main request only. */
    public function onRequest(RequestEvent $event): void
    {
        if (!$event->isMainRequest()) {
            return;
        }

        $this->mainRequests++;
        $request = $event->getRequest();
        // A CORS preflight is the app's CORS listener to answer, which runs after the boundary.
        if (RawTarget::isPreflight($request)) {
            return;
        }

        $contract = $this->contract();
        $match = $contract->match($request->getMethod(), RawTarget::path($request));
        if ($match === null) {
            return;
        }

        $operationId = $match->operationId;
        $unready = $this->unready($contract);
        if ($unready !== null) {
            $this->answer($event, ReplyVerdict::internalError($this->hooks, $contract, $operationId, $unready, null));

            return;
        }

        if ($operationId === null) {
            if ($contract->defaults['catch_all'] ?? true) {
                $this->answer($event, ReplyVerdict::roleReply($contract, null, self::NOT_FOUND_ROLE, self::NOT_FOUND_STATUS));
            }

            return;
        }

        $state = new BoundaryState($contract, $operationId, $match->rawParameters, RawTarget::view($request), $this->hooks);
        $request->attributes->set(BoundaryState::attributeName($contract->api), $state);

        try {
            $request->attributes->set($this->attribute('decoded'), InputDecoding::read($request, $state));
        } catch (ContractRefusal $refusal) {
            $this->answer($event, $refusal->render($request));
        } catch (\Throwable $failure) {
            $this->answer($event, ReplyVerdict::internalError($this->hooks, $contract, $operationId, 'the request failed before a reply was written', $failure));
        }
    }

    /** Marks that routing ran, so the way out may read the chosen route. */
    public function onRouted(RequestEvent $event): void
    {
        if ($event->isMainRequest()) {
            $event->getRequest()->attributes->set($this->attribute('routed'), true);
        }
    }

    /** The fail-closed checks, then steps 2 to 8; on every request, sub-requests included. */
    public function onController(ControllerEvent $event): void
    {
        $request = $event->getRequest();
        $contract = $this->contract();
        $attribute = $event->getAttributes(SeampactOperation::class)[0] ?? null;
        $attributeOperation = $attribute instanceof SeampactOperation ? $attribute->operationId : null;
        $routeName = $request->attributes->get(self::ROUTE_ATTRIBUTE);
        $routeOperation = $request->attributes->get(self::OPERATION_DEFAULT);
        $contractRoute = is_string($routeName) && is_string($routeOperation) && $routeName === $contract->routeName($routeOperation);
        if ($attributeOperation === null && !$contractRoute) {
            return;
        }

        if (!$contractRoute) {
            throw new ContractBypassedException("The handler of operation '{$attributeOperation}' of api '{$contract->api}' was reached through a route that is not the contract's; serve it only through its generated route.");
        }

        if ($attributeOperation !== $routeOperation) {
            throw new ContractBypassedException("The contract route of operation '{$routeOperation}' of api '{$contract->api}' leads to a method without #[SeampactOperation('{$routeOperation}')]; mark the handler method with it.");
        }

        $state = BoundaryState::of($request, $contract->api);
        if ($state === null || !$event->isMainRequest()) {
            throw new ContractBypassedException("The contract route of operation '{$routeOperation}' of api '{$contract->api}' was reached without the boundary's step 1, as a sub-request from forward() or render(controller()) is.");
        }

        if ($state->operationId !== $routeOperation) {
            throw AccessSteps::roleRefusal($state, self::NOT_FOUND_ROLE);
        }

        try {
            AccessSteps::run($request, $state);
        } catch (\Throwable $failure) {
            // A refusal keeps its role, read from the role map the boundary maps native exceptions with.
            if ($failure instanceof ContractRefusal || ExceptionRoles::isNativeRefusal($failure)) {
                throw $failure;
            }

            throw new BoundaryFailure($failure);
        }
        $state->admitted = true;

        try {
            $request->attributes->set($this->inputAttribute(), $this->checkedInput($request, $state));
        } catch (ContractRefusal $refusal) {
            throw $refusal;
        } catch (\Throwable $failure) {
            throw new BoundaryFailure($failure);
        }
    }

    /** The reply of a generated result. */
    public function onView(ViewEvent $event): void
    {
        $result = $event->getControllerResult();
        if (is_object($result) && $this->contract()->resultOf($result) !== null) {
            $event->setResponse(Replies::result($event->getRequest(), $this->contract()->api, $result));
        }
    }

    public function onFirstException(ExceptionEvent $event): void
    {
        if ($event->isMainRequest()) {
            $this->record($event->getRequest(), $event->getThrowable());
        }
    }

    /** The boundary's refusals and failures and the generated exceptions; any other exception goes to the app first. */
    public function onException(ExceptionEvent $event): void
    {
        $request = $event->getRequest();
        $state = BoundaryState::of($request, $this->contract()->api);
        $exception = $event->getThrowable();
        if ($state === null || ExceptionRoles::isNativeRefusal($exception)) {
            return;
        }

        $event->allowCustomResponseCode();
        try {
            $reply = $this->rendered($request, $state, $exception);
        } catch (\Throwable $failure) {
            $this->answer($event, ReplyVerdict::internalError($this->hooks, $state->contract, $state->operationId, 'a boundary step failed', $failure));

            return;
        }

        if ($reply !== null) {
            $event->setResponse($reply);

            return;
        }

        if ($exception instanceof BoundaryFailure || $exception instanceof ContractBypassedException) {
            $cause = $exception instanceof BoundaryFailure ? ($exception->getPrevious() ?? $exception) : $exception;
            $this->answer($event, ReplyVerdict::internalError($this->hooks, $state->contract, $state->operationId, 'a boundary step failed', $cause));
        }
    }

    /** An exception no app listener answered: the api's 500, never Symfony's error page. */
    public function onUnmappedException(ExceptionEvent $event): void
    {
        $request = $event->getRequest();
        $state = BoundaryState::of($request, $this->contract()->api);
        $exception = $event->getThrowable();
        // The firewall's listener replaces a refusal with an HTTP exception; the recorded first exception keeps its kind.
        $recorded = $request->attributes->get($this->attribute('exception'));
        $first = $recorded instanceof \Throwable ? $recorded : $exception;
        if ($state === null || $event->hasResponse() || ExceptionRoles::isNativeRefusal($exception) || ExceptionRoles::isNativeRefusal($first)) {
            return;
        }

        // The router's 404 or 405 for a path step 1 matched raw: `ErrorListener` writes it, the way out answers notFound.
        if ($this->routedElsewhere($request, $state, $first)) {
            return;
        }

        $event->allowCustomResponseCode();
        $this->answer($event, ReplyVerdict::internalError($this->hooks, $state->contract, $state->operationId, 'an exception reached the boundary unmapped', $exception));
    }

    /** An authenticator's failure, whose reply never reaches `kernel.exception`, recorded when it ends with a reply. */
    public function onLoginFailure(object $event): void
    {
        if (!method_exists($event, 'getResponse') || !method_exists($event, 'getException') || !method_exists($event, 'getRequest')) {
            return;
        }

        $request = $event->getRequest();
        $exception = $event->getException();
        if ($event->getResponse() !== null && $request instanceof Request && $exception instanceof \Throwable) {
            $this->record($request, $exception);
        }
    }

    /** The route check, the mapping of a native refusal and step 10, on the main request only. */
    public function onResponse(ResponseEvent $event): void
    {
        $request = $event->getRequest();
        $response = $event->getResponse();
        // Whatever the event holds now is compared, so a listener that replaced the reply object is caught too.
        if ($event->isMainRequest() && $request->attributes->has($this->attribute('final_signature'))) {
            $this->refuseRewrittenReply($event, $response);

            return;
        }

        $state = $event->isMainRequest() ? BoundaryState::of($request, $this->contract()->api) : null;
        if ($state === null) {
            return;
        }

        $recorded = $request->attributes->get($this->attribute('exception'));
        $checked = $this->checked($request, $state, $response, $recorded instanceof \Throwable ? $recorded : null);
        if ($checked !== $response) {
            $event->setResponse($checked->prepare($request));
        }
    }

    private function checked(Request $request, BoundaryState $state, Response $response, ?\Throwable $exception): Response
    {
        $contract = $state->contract;
        if ($this->routedElsewhere($request, $state, $exception)) {
            return $state->author(ReplyVerdict::roleReply($contract, $state->operationId, self::NOT_FOUND_ROLE, self::NOT_FOUND_STATUS));
        }

        $role = $exception === null ? null : $this->roleOf($state, $exception, $response);
        if ($exception !== null && $role !== null) {
            $reply = ReplyVerdict::mapped($state, $response, $role, $exception, ExceptionRoles::KEPT_HEADERS);
            $retryAfter = ExceptionRoles::retryAfter($exception);
            if ($retryAfter !== null && !$reply->headers->has('Retry-After')) {
                $reply->headers->set('Retry-After', $retryAfter);
            }

            return $reply;
        }

        // A reply an app's own `kernel.exception` listener wrote for an exception no role maps is judged as written below.
        try {
            $responses = $this->settings->responsesOf($state->operationId);
        } catch (\UnexpectedValueException $invalid) {
            return ReplyVerdict::internalError($this->hooks, $contract, $state->operationId, $invalid->getMessage(), null);
        }

        $etag = $contract->defaults['framework_etag'] ?? null;

        return ReplyVerdict::checked($state, $response, $exception, $responses, is_string($etag) ? $etag : null);
    }

    /**
     * The role of a native refusal. The firewall still sees a caller the authenticate hook admitted as anonymous, so
     * it answers a later access denial with its entry point; the caller is known, so that denial is forbidden.
     */
    private function roleOf(BoundaryState $state, \Throwable $exception, Response $response): ?string
    {
        $role = ExceptionRoles::roleOf($exception, $response);
        if ($role === self::UNAUTHENTICATED_ROLE && $state->principal !== null && ExceptionRoles::isAccessDenial($exception)) {
            return self::FORBIDDEN_ROLE;
        }

        return $role;
    }

    // Once routing ran, a route other than this operation's contract route answers the raw path's 404.
    private function routedElsewhere(Request $request, BoundaryState $state, ?\Throwable $exception): bool
    {
        if ($request->attributes->get($this->attribute('routed')) === true) {
            return $request->attributes->get(self::ROUTE_ATTRIBUTE) !== $state->contract->routeName($state->operationId);
        }

        return $exception instanceof NotFoundHttpException || $exception instanceof MethodNotAllowedHttpException;
    }

    /** The boundary's reply to an exception it renders itself, null for one it answers with the api's 500. */
    private function rendered(Request $request, BoundaryState $state, \Throwable $exception): ?Response
    {
        if ($exception instanceof ContractRefusal && $exception->api === $state->contract->api) {
            return $exception->render($request);
        }

        $contractException = $this->contractExceptionClass();
        if (!$exception instanceof $contractException || !method_exists($exception, 'contractCode')) {
            return null;
        }

        $code = $exception->contractCode();
        $params = property_exists($exception, 'params') && is_object($exception->params) ? $exception->params : null;

        return Replies::thrown($request, $state->contract->api, is_string($code) ? $code : '', $params);
    }

    /** Step 6 through the app's validator, then steps 7 and 8: the typed input. */
    private function checkedInput(Request $request, BoundaryState $state): object
    {
        $decoded = $request->attributes->get($this->attribute('decoded'));
        if (!$decoded instanceof DecodedInput) {
            throw new \LogicException("seampact: the decoded input of operation '{$state->operationId}' is missing; step 1 did not run on this request.");
        }

        $tree = (object) ['path' => (object) $decoded->path, 'query' => (object) $decoded->query, 'header' => (object) $decoded->headers];
        if ($state->body !== null) {
            $tree->body = $state->body;
        }

        $issues = [];
        foreach ($this->validator->validate($tree, $this->inputConstraint($state->operationId)) as $violation) {
            $issues[] = self::issueOf($violation->getPropertyPath(), Issue::ruleOf($violation));
        }
        if ($issues !== []) {
            throw AccessSteps::schemaInvalid($state, array_slice(array_values(array_unique($issues, SORT_REGULAR)), 0, self::MAX_RENDERED_ISSUES));
        }

        return TypedInput::build($state, ['path' => $tree->path, 'query' => $tree->query, 'headers' => $tree->header]);
    }

    /** @return array{in: string, pointer: string, rule: string} */
    private static function issueOf(string $path, string $rule): array
    {
        $tokens = explode('/', $path, 3);
        $part = $tokens[1] ?? '';
        if (!in_array($part, self::PARTS, true)) {
            throw new \LogicException("seampact: a violation of the contract input is at '{$path}', outside the input's parts; regenerate the code.");
        }

        return ['in' => $part, 'pointer' => isset($tokens[2]) ? '/' . $tokens[2] : '', 'rule' => $rule];
    }

    /**
     * Why the api does not serve on this container instance, null when it does: a second main request, which only a
     * worker runtime sends, or a hook problem of the boot check.
     */
    private function unready(ApiContract $contract): ?string
    {
        if ($this->mainRequests > 1) {
            return self::WORKER_REFUSAL . ': this container instance serves a second main request, as a worker runtime does; serve the app with php-fpm, or keep this api\'s bundle out of the worker app';
        }

        $this->hookProblems ??= $this->checksHooks() ? HookCheckWarmer::problems($this->hooks, $contract) : [];

        return $this->hookProblems === [] ? null : HookCheckWarmer::report($contract, $this->hookProblems);
    }

    private function record(Request $request, \Throwable $exception): void
    {
        if (!$request->attributes->has($this->attribute('exception'))) {
            $request->attributes->set($this->attribute('exception'), $exception);
        }
    }

    /** Sets a reply the boundary writes as the request's final one, which the way out leaves as is unless rewritten. */
    private function answer(RequestEvent $event, Response $reply): void
    {
        $request = $event->getRequest();
        $request->attributes->set($this->attribute('final'), $reply);
        $request->attributes->set($this->attribute('final_signature'), self::signatureOf($request, $reply));
        $event->setResponse($reply);
    }

    /** An app's `kernel.response` listener that rewrote or replaced the boundary's own reply: the api's 500. */
    private function refuseRewrittenReply(ResponseEvent $event, Response $reply): void
    {
        $request = $event->getRequest();
        if (self::signatureOf($request, $reply) === $request->attributes->get($this->attribute('final_signature'))) {
            return;
        }

        $operationId = BoundaryState::of($request, $this->contract()->api)?->operationId;
        $refusal = ReplyVerdict::internalError($this->hooks, $this->contract(), $operationId, "a kernel.response listener rewrote the boundary's reply", null);
        $event->setResponse($refusal->prepare($request));
    }

    /**
     * The status, media type and body of a reply; headers an app adds (CORS, security headers) are not part of it, nor
     * the body of a HEAD reply, which `Response::prepare()` empties.
     */
    private static function signatureOf(Request $request, Response $reply): string
    {
        $content = $request->isMethod('HEAD') ? '' : $reply->getContent();

        return $reply->getStatusCode() . "\n" . $reply->headers->get('Content-Type', '') . "\n" . hash('sha256', is_string($content) ? $content : '');
    }

    private function attribute(string $name): string
    {
        return "_seampact_{$this->contract()->api}_{$name}";
    }

    private function contract(): ApiContract
    {
        return ApiContract::of($this->contractClass());
    }
}
