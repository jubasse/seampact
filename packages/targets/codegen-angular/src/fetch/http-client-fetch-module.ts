// The `http-client-fetch.ts` every api of the angular target gets: a `fetch` that sends through Angular's
// `HttpClient`, so the app's interceptors, its XSRF settings and `withFetch()` apply to every call of the generated
// fetch client, which then reads the answer as it reads the platform fetch's. It is the same for every api.

/** The module name of the HttpClient fetch, beside the service. */
export const HTTP_CLIENT_FETCH_MODULE = "http-client-fetch";

/** The source of `http-client-fetch.ts`. */
export const HTTP_CLIENT_FETCH_SOURCE = `import { HttpClient, HttpErrorResponse, HttpHeaders } from "@angular/common/http";

// Statuses whose answer has no body: a \`Response\` refuses one.
const NULL_BODY_STATUSES = [204, 205, 304];

/**
 * A \`fetch\` that sends through Angular's \`HttpClient\`, so the app's interceptors, XSRF settings and \`withFetch()\`
 * apply, and answers with a \`Response\` the client reads as it reads the platform fetch's. An HTTP error status is an
 * answer, not a rejection; a request that reached no server rejects with a \`TypeError\`, as fetch does, and an abort of
 * the signal unsubscribes, which cancels the request.
 */
export function httpClientFetch(http: HttpClient): typeof fetch {
return (input, init) => {
if (typeof input !== "string" && !(input instanceof URL)) {
return Promise.reject(new TypeError("httpClientFetch: the input is a Request object; pass its URL and init instead."));
}

const signal = init?.signal ?? undefined;

if (signal?.aborted) return Promise.reject(signal.reason);

return new Promise<Response>((resolve, reject) => {
const onAbort = () => {
subscription.unsubscribe();
reject(signal?.reason);
};
const settle = () => signal?.removeEventListener("abort", onAbort);
// A status the Response refuses rejects the call; thrown inside an rxjs callback it would leave the promise pending.
const answer = (body: unknown, status: number, headers: HttpHeaders) => {
try {
resolve(responseOf(body, status, headers));
} catch (refusal) {
reject(refusal);
}
};
const subscription = http
.request(init?.method ?? "GET", String(input), {
body: init?.body ?? null,
headers: httpHeadersOf(init?.headers),
observe: "response",
responseType: "text",
})
.subscribe({
next: (response) => {
settle();
answer(response.body, response.status, response.headers);
},
error: (failure: unknown) => {
settle();

if (failure instanceof HttpErrorResponse && failure.status !== 0) {
answer(failure.error, failure.status, failure.headers);

return;
}

const reason = failure instanceof HttpErrorResponse ? "reached no server" : "failed before an answer";

reject(new TypeError(\`httpClientFetch: the request to \${String(input)} \${reason}.\`, { cause: failure }));
},
});

// An interceptor that answers at once has settled the call already.
if (!subscription.closed) signal?.addEventListener("abort", onAbort, { once: true });
});
};
}

function httpHeadersOf(headers: HeadersInit | undefined): HttpHeaders {
const plain: Record<string, string> = {};

new Headers(headers).forEach((value, name) => {
plain[name] = value;
});

return new HttpHeaders(plain);
}

function responseOf(body: unknown, status: number, headers: HttpHeaders): Response {
const fetchHeaders = new Headers();

for (const name of headers.keys()) {
for (const value of headers.getAll(name) ?? []) fetchHeaders.append(name, value);
}

const hadContentType = fetchHeaders.has("content-type");
const bodyText = bodyTextOf(body);
const withoutBody = NULL_BODY_STATUSES.includes(status) || bodyText === null || bodyText === "";

// An interceptor can answer an object: it is read as JSON.
if (typeof body === "object" && body !== null && !hadContentType) fetchHeaders.set("content-type", "application/json");

try {
const response = new Response(withoutBody ? null : bodyText, { status, headers: fetchHeaders });

// A string body gets a text type from the Response; the server sent none.
if (!hadContentType && typeof body !== "object") response.headers.delete("content-type");

return response;
} catch (refusal) {
throw new TypeError(\`httpClientFetch: an answer with status \${status} cannot be read as a Response.\`, { cause: refusal });
}
}

function bodyTextOf(body: unknown): string | null {
if (body === null || body === undefined) return null;

return typeof body === "string" ? body : JSON.stringify(body);
}`;
