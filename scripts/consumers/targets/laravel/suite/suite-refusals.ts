// The cases the Laravel consumer does not run yet, by case id, with the reason: a case calling an operation the
// consumer does not serve yet waits for the PR that generates its forms (ADR 0023 "Delivery"). The consumer serves
// every operation of the reference contract, so none waits.
export const LARAVEL_SUITE_REFUSALS: Readonly<Record<string, string>> = {};
