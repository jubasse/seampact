// The cases the DRF consumer does not run, by case id, with the reason. The consumer serves every operation of the
// reference contract's two apis, so it runs every case; what the next release brings (DRF's own authentication,
// permission and throttle classes per access kind, absolute URLs) has no case in the suite yet.
export const DRF_SUITE_REFUSALS: Readonly<Record<string, string>> = {};
