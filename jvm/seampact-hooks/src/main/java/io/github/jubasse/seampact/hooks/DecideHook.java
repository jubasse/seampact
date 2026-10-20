package io.github.jubasse.seampact.hooks;

/**
 * One for every requirement, right or rule; the boundary loops over several requests.
 *
 * @param <Request> the requirement's generated request record
 * @param <Codes> the codes the request declares, the only ones a denial may name
 */
public interface DecideHook<
        Request extends RequirementRequest<Codes, ?, ?, ?, ?>, Codes extends ErrorCodeWithParams> {
    Decision<Codes> decide(Request request);
}
