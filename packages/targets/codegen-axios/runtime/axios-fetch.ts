import type { AxiosInstance, AxiosResponse } from "axios";

// Statuses whose `Response` cannot carry a body.
const BODYLESS_STATUSES: readonly number[] = [101, 204, 205, 304];

/**
 * A `fetch` that sends through your axios instance, so its interceptors, base settings and adapter apply. Every
 * HTTP status comes back as a response: the client sorts statuses itself, so axios never rejects on one. A network
 * failure rejects, and so does an abort, with the signal's reason as `fetch` does.
 */
export function fetchOfAxios(instance: AxiosInstance): typeof fetch {
  return async (input, init) => {
    const signal = init?.signal ?? undefined;
    const method = init?.method;

    try {
      const response = await instance.request<string>({
        url: requestUrlOf(input),
        ...(method === undefined ? {} : { method }),
        headers: Object.fromEntries(new Headers(init?.headers)),
        data: init?.body,
        ...(signal === undefined ? {} : { signal }),
        validateStatus: () => true,
        responseType: "text",
        transformResponse: (text: string) => text,
      });

      return responseOf(response);
    } catch (failure) {
      if (signal?.aborted) throw signal.reason;

      throw failure;
    }
  };
}

function requestUrlOf(input: Parameters<typeof fetch>[0]): string {
  return input instanceof Request ? input.url : String(input);
}

function responseOf(response: AxiosResponse<string>): Response {
  const headers = new Headers();

  for (const [name, value] of Object.entries(response.headers)) {
    for (const each of Array.isArray(value) ? value : [value]) {
      if (each !== undefined && each !== null) headers.append(name, String(each));
    }
  }

  const hasBody = !BODYLESS_STATUSES.includes(response.status) && response.data !== "";

  return new Response(hasBody ? response.data : null, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
