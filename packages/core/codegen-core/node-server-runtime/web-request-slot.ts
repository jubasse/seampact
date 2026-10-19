// The request slot of the Web-standard server targets (ADR 0020 "Placement"): the app's wrapped `fetch` opens an
// empty slot per request, a contract route's handler enters its outgoing check in it, and the wrapper runs that
// check on the `Response` before returning it. Every api's copy of the runtime shares one slot store and one set of
// wrapped apps, kept on the global object under registered symbols. Copied into the generated tree as is.
import { AsyncLocalStorage } from "node:async_hooks";

/** One request's slot, empty until a contract route's handler enters it. */
export interface RequestSlot {
  /** The outgoing check of the contract route whose handler entered the slot. */
  outgoing?: (response: Response) => Promise<Response>;
}

// One key for every copy of this module, so two apis generated apart share one slot and one wrap.
const SLOT_STORE_KEY = Symbol.for("seampact.web-server.request-slots");
const WRAPPED_APPS_KEY = Symbol.for("seampact.web-server.wrapped-apps");

function slotStore(): AsyncLocalStorage<RequestSlot> {
  const existing: unknown = Reflect.get(globalThis, SLOT_STORE_KEY);

  if (existing instanceof AsyncLocalStorage) return existing;

  const created = new AsyncLocalStorage<RequestSlot>();

  Reflect.set(globalThis, SLOT_STORE_KEY, created);

  return created;
}

function wrappedApps(): WeakSet<object> {
  const existing: unknown = Reflect.get(globalThis, WRAPPED_APPS_KEY);

  if (existing instanceof WeakSet) return existing;

  const created = new WeakSet<object>();

  Reflect.set(globalThis, WRAPPED_APPS_KEY, created);

  return created;
}

/** The slot of the request being served, absent outside the wrapped `fetch`. */
export function currentRequestSlot(): RequestSlot | undefined {
  return slotStore().getStore();
}

/**
 * Runs one request's `fetch` in a fresh slot, then the outgoing check a contract route's handler entered, if any,
 * on the `Response` it returned.
 */
export async function servedInRequestSlot(
  fetch: () => Response | Promise<Response>,
): Promise<Response> {
  const slot: RequestSlot = {};
  const response = await slotStore().run(slot, fetch);

  return slot.outgoing === undefined ? response : slot.outgoing(response);
}

/** Records that an app's `fetch` is wrapped; false when an earlier registration on the app already wrapped it. */
export function claimFetchWrap(app: object): boolean {
  const wrapped = wrappedApps();

  if (wrapped.has(app)) return false;

  wrapped.add(app);

  return true;
}
