// One global no-op app interceptor, registered with `useGlobalInterceptors` when the bench runs with
// `--app-interceptor` (`BENCH_APP_INTERCEPTOR=1`), on the seampact server and on the hand-written baseline alike: it
// measures what NestJS's interceptor path costs each of them.
import type { CallHandler, ExecutionContext, INestApplication, NestInterceptor } from "@nestjs/common";
import type { Observable } from "rxjs";

const APP_INTERCEPTOR_ON = "1";

class NoOpAppInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle();
  }
}

export function useBenchAppInterceptor(app: INestApplication): void {
  if (process.env.BENCH_APP_INTERCEPTOR === APP_INTERCEPTOR_ON) {
    app.useGlobalInterceptors(new NoOpAppInterceptor());
  }
}
