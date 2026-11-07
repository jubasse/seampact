// The consumer case of an app's own NestJS layers around the generated `tasks` boundary: a passport JWT guard as a
// global `APP_GUARD` and at route level above and below the composite, `ClassSerializerInterceptor` and a recording
// interceptor registered with `useGlobalInterceptors`, a global `ValidationPipe` that validates custom decorators and
// a recording `@Catch()` filter. The JWT strategy keeps the validated user
// in an app request store, as `nestjs-cls` apps do, which the `user` authenticate hook reads.
import { AsyncLocalStorage } from "node:async_hooks";
import type { ServerResponse } from "node:http";
import {
  type ArgumentMetadata,
  type ArgumentsHost,
  type CallHandler,
  Catch,
  ClassSerializerInterceptor,
  Controller,
  type ExceptionFilter,
  type ExecutionContext,
  type INestApplication,
  Inject,
  Injectable,
  Module,
  type NestInterceptor,
  SetMetadata,
  UseGuards,
  ValidationPipe,
} from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_PIPE, Reflector } from "@nestjs/core";
import { AuthGuard, PassportModule, PassportStrategy } from "@nestjs/passport";
import type { AuthenticateRequest, AuthenticateResult } from "@seampact/hooks";
import { ExtractJwt, Strategy } from "passport-jwt";
import { catchError, map, type Observable, tap, throwError } from "rxjs";
import * as TasksNest from "../generated/server/tasks/index.js";
import type * as Tasks from "../generated/types/tasks/index.js";
import {
  DraftsController,
  HooksController,
  PreferencesController,
  TasksController,
} from "./controllers.mjs";
import { tasksHandlers } from "./handlers.mjs";
import { tasksHooks } from "./hooks.mjs";

/** The HS256 secret the app's JWT strategy verifies with. */
export const APP_JWT_SECRET = "seampact-app-layers-secret";

/** What the app's layers and the authenticate hook saw, in request order; the test empties it. */
export const appLayerEvents: string[] = [];

/** The body the app's interceptor maps the `health` result to, which reaches the wire in the interceptor mode only. */
export const MAPPED_BY_APP = { status: "mapped by app" };

const HEALTH_HANDLER = "health";

/** The status the app's filter answers, which no operation declares. */
export const APP_FILTER_STATUS = 418;

interface AppUser {
  readonly userId: string;
}

// The app's per-request store, opened by an app middleware after the body parser.
const appRequestStore = new AsyncLocalStorage<{ user?: AppUser }>();

export function openAppRequestStore(_request: unknown, _response: unknown, next: () => void): void {
  appRequestStore.run({}, next);
}

const IS_PUBLIC = "app:isPublic";

/** The app's own marker of a route its global JWT guard skips. */
const Public = () => SetMetadata(IS_PUBLIC, true);

@Injectable()
class AppJwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: APP_JWT_SECRET,
    });
  }

  validate(payload: { readonly sub: string }): AppUser {
    const user = { userId: payload.sub };
    const store = appRequestStore.getStore();

    appLayerEvents.push(`passport ${user.userId}`);

    if (store !== undefined) store.user = user;

    return user;
  }
}

@Injectable()
class AppGlobalJwtGuard extends AuthGuard("jwt") {
  @Inject(Reflector) private readonly reflector!: Reflector;

  override canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);

    return isPublic === true ? true : super.canActivate(context);
  }
}

@Injectable()
class RecordingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    appLayerEvents.push(`interceptor before ${context.getHandler().name}`);

    const handler = context.getHandler().name;

    return next.handle().pipe(
      tap((value: unknown) => appLayerEvents.push(`interceptor after ${String(value)}`)),
      map((value: unknown) =>
        handler === HEALTH_HANDLER && isHandlerResult(value)
          ? { ...value, body: MAPPED_BY_APP }
          : value,
      ),
      catchError((error: unknown) => {
        appLayerEvents.push(`interceptor error ${errorText(error)}`);

        return throwError(() => error);
      }),
    );
  }
}

@Injectable()
class RecordingValidationPipe extends ValidationPipe {
  constructor() {
    super({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      validateCustomDecorators: true,
    });
  }

  override transform(value: unknown, metadata: ArgumentMetadata) {
    appLayerEvents.push(`pipe ${metadata.type}`);

    return super.transform(value, metadata);
  }
}

@Catch()
class RecordingAppFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    if (TasksNest.renderPreRoutingError(exception, host)) return;

    appLayerEvents.push(`filter ${errorText(exception)}`);

    const response = host.switchToHttp().getResponse<ServerResponse>();

    response.statusCode = APP_FILTER_STATUS;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ caughtBy: "app" }));
  }
}

function isHandlerResult(value: unknown): value is { readonly status: number } {
  return (
    typeof value === "object" && value !== null && typeof Reflect.get(value, "status") === "number"
  );
}

/** The app's global interceptors, registered as `main.ts` would, inside the seampact reply interceptor. */
export function useAppInterceptors(app: INestApplication): void {
  app.useGlobalInterceptors(
    new ClassSerializerInterceptor(app.get(Reflector)),
    new RecordingInterceptor(),
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.constructor.name} ${error.message}` : String(error);
}

// The user identity, as the app's JWT strategy validated it for this request.
const storeUserAuthenticateHook = {
  authenticate(
    _request: AuthenticateRequest<{ readonly bearer?: string; readonly sessionCookie?: string }>,
  ): AuthenticateResult<AppUser, { readonly code: "api.unauthenticated" }> {
    const user = appRequestStore.getStore()?.user;

    appLayerEvents.push(`authenticate ${user?.userId ?? "none"}`);

    return user === undefined
      ? { deny: { code: "api.unauthenticated" } }
      : { principal: { userId: user.userId } };
  },
};

function appLayersHooks() {
  const hooks = tasksHooks();

  return { ...hooks, authenticate: { ...hooks.authenticate, user: storeUserAuthenticateHook } };
}

// `health` is public with the marker below its composite; `listChannels` skips the global guard with the marker
// above and authenticates with a route guard above the composite; `getChannel` with a route guard below it.
@Controller()
class AppLayersController implements TasksNest.AppEndpoints {
  @TasksNest.health()
  @Public()
  health(@TasksNest.health.input() _input: Tasks.HealthInput) {
    return tasksHandlers.health();
  }
}

@Controller()
class AppLayersChannelsController implements TasksNest.ChannelsEndpoints {
  @UseGuards(AuthGuard("jwt"))
  @Public()
  @TasksNest.listChannels()
  listChannels(@TasksNest.listChannels.input() input: Tasks.ListChannelsInput) {
    return tasksHandlers.listChannels(input);
  }

  @Public()
  @TasksNest.getChannel()
  @UseGuards(AuthGuard("jwt"))
  getChannel(@TasksNest.getChannel.input() input: TasksNest.HandlerInputs["getChannel"]) {
    return tasksHandlers.getChannel(input);
  }
}

@Module({
  imports: [PassportModule, TasksNest.SeampactModule.forRoot(appLayersHooks())],
  controllers: [
    AppLayersController,
    AppLayersChannelsController,
    TasksController,
    DraftsController,
    PreferencesController,
    HooksController,
  ],
  providers: [
    AppJwtStrategy,
    { provide: APP_GUARD, useClass: AppGlobalJwtGuard },
    { provide: APP_PIPE, useClass: RecordingValidationPipe },
    { provide: APP_FILTER, useClass: RecordingAppFilter },
  ],
})
export class AppLayersModule {}
