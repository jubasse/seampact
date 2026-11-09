import axios, { type AxiosInstance } from "axios";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { callOperation, type OperationPlan } from "../../codegen-fetch/runtime/client-runtime.js";
import { fetchOfAxios } from "../runtime/axios-fetch.js";

const BASE = "http://api.test";
const plan: OperationPlan = {
  method: "get",
  path: "/notes/{noteId}",
  query: [],
  headers: [],
  hasJsonBody: false,
  successes: [{ status: 200, shape: "item", payload: [] }],
  notModified: false,
  errors: [{ code: "api.not_found", status: 404 }],
};
const server = setupServer(
  http.get(`${BASE}/notes/n1`, () => HttpResponse.json({ id: "n1" })),
  http.get(`${BASE}/notes/missing`, () =>
    HttpResponse.json({ code: "api.not_found" }, { status: 404 }),
  ),
  http.get(`${BASE}/notes/boom`, () => HttpResponse.text("oops", { status: 500 })),
  http.get(`${BASE}/notes/slow`, async () => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return HttpResponse.json({ id: "slow" });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const call = (instance: AxiosInstance, id: string, signal?: AbortSignal) =>
  callOperation<Record<string, unknown>>(
    { baseUrl: BASE, fetch: fetchOfAxios(instance) },
    plan,
    { path: { noteId: id } },
    signal === undefined ? {} : { signal },
  );

test("a success, a declared error and an unexpected status are results, never throws", async () => {
  const instance = axios.create();

  expect(await call(instance, "n1")).toMatchObject({ ok: true, status: 200, body: { id: "n1" } });
  expect(await call(instance, "missing")).toMatchObject({
    ok: false,
    unexpected: false,
    code: "api.not_found",
  });
  expect(await call(instance, "boom")).toMatchObject({
    ok: false,
    unexpected: true,
    status: 500,
    body: "oops",
  });
});

test("an abort rejects with the signal's reason", async () => {
  const controller = new AbortController();
  const pending = call(axios.create(), "slow", controller.signal);

  controller.abort(new DOMException("stop", "AbortError"));

  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});

test("a timeout signal rejects with TimeoutError", async () => {
  await expect(call(axios.create(), "slow", AbortSignal.timeout(50))).rejects.toMatchObject({
    name: "TimeoutError",
  });
});

test("the app's instance interceptors and defaults apply", async () => {
  const seen: string[] = [];
  const instance = axios.create({ headers: { "x-app": "yes" } });

  instance.interceptors.request.use((config) => {
    config.headers.set("authorization", "Bearer t");
    return config;
  });
  instance.interceptors.response.use((response) => {
    seen.push(`${response.status}`);
    return response;
  });
  server.use(
    http.get(`${BASE}/notes/n1`, ({ request }) =>
      HttpResponse.json({
        id: request.headers.get("authorization"),
        app: request.headers.get("x-app"),
      }),
    ),
  );

  expect(await call(instance, "n1")).toMatchObject({ body: { id: "Bearer t", app: "yes" } });
  expect(seen).toEqual(["200"]);
});

test("an interceptor that rejects an error status rejects the call", async () => {
  const instance = axios.create();

  instance.interceptors.response.use((response) => {
    if (response.status >= 400) throw new Error("session expired");
    return response;
  });

  await expect(call(instance, "missing")).rejects.toThrow("session expired");
});

test("an interceptor that returns response.data is refused by name", async () => {
  const instance = axios.create();

  instance.interceptors.response.use((response) => response.data);

  await expect(call(instance, "n1")).rejects.toThrow(
    "axios interceptors must return the axios response, not response.data",
  );
});
