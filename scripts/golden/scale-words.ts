// The word lists the scale generator draws names from. They describe warehouses and billing in general terms, so
// no name of a real product or customer reaches the fixture.

export interface ResourceName {
  singular: string;
  plural: string;
}

export const SCALE_SEED = 20_270_115;

export const INVENTORY_GENERATED_RESOURCES: ResourceName[] = [
  { singular: "Pallet", plural: "pallets" },
  { singular: "Crate", plural: "crates" },
  { singular: "Lot", plural: "lots" },
  { singular: "Supplier", plural: "suppliers" },
  { singular: "Carrier", plural: "carriers" },
  { singular: "DockDoor", plural: "dockDoors" },
  { singular: "Forklift", plural: "forklifts" },
  { singular: "Zone", plural: "zones" },
  { singular: "Label", plural: "labels" },
  { singular: "StockCount", plural: "stockCounts" },
  { singular: "ReturnOrder", plural: "returnOrders" },
  { singular: "PickList", plural: "pickLists" },
  { singular: "Adjustment", plural: "adjustments" },
];

export const BILLING_GENERATED_RESOURCES: ResourceName[] = [
  { singular: "Invoice", plural: "invoices" },
  { singular: "Payment", plural: "payments" },
  { singular: "Refund", plural: "refunds" },
  { singular: "TaxRate", plural: "taxRates" },
  { singular: "Customer", plural: "customers" },
  { singular: "Subscription", plural: "subscriptions" },
  { singular: "Plan", plural: "plans" },
  { singular: "Coupon", plural: "coupons" },
  { singular: "CreditNote", plural: "creditNotes" },
  { singular: "Payout", plural: "payouts" },
  { singular: "Dispute", plural: "disputes" },
  { singular: "PriceList", plural: "priceLists" },
  { singular: "LedgerEntry", plural: "ledgerEntries" },
  { singular: "Statement", plural: "statements" },
  { singular: "Receipt", plural: "receipts" },
  { singular: "Reminder", plural: "reminders" },
];

// The verbs of the custom routes the generator writes, one per resource from the first resource on.
export const INVENTORY_GENERATED_ACTIONS = ["seal", "inspect", "quarantine"];
export const BILLING_GENERATED_ACTIONS = [
  "send",
  "capture",
  "approve",
  "publish",
  "cancel",
  "apply",
  "close",
];

// Domain enums of the catalogue: dense reuse comes from every resource and value schema using one of them.
export const DOMAIN_ENUMS: { name: string; values: string[] }[] = [
  { name: "Priority", values: ["low", "normal", "high", "urgent"] },
  { name: "Visibility", values: ["private", "team", "public"] },
  { name: "Condition", values: ["new", "used", "damaged"] },
  { name: "Currency", values: ["eur", "usd", "gbp", "jpy"] },
  { name: "Unit", values: ["piece", "kilogram", "litre", "metre"] },
  { name: "Origin", values: ["domestic", "import", "transfer"] },
  { name: "Grade", values: ["a", "b", "c"] },
  { name: "Region", values: ["north", "south", "east", "west", "central"] },
  { name: "Stage", values: ["draft", "active", "closed"] },
  { name: "Rating", values: ["poor", "fair", "good", "excellent"] },
];

// Error code stems shared by the domain families; the status and nature follow from the stem.
export const ERROR_STEMS: { stem: string; status: number; nature: "refused" | "unavailable" }[] = [
  { stem: "missing", status: 404, nature: "refused" },
  { stem: "locked", status: 423, nature: "refused" },
  { stem: "expired", status: 410, nature: "refused" },
  { stem: "duplicated", status: 409, nature: "refused" },
  { stem: "limited", status: 429, nature: "unavailable" },
  { stem: "mismatched", status: 422, nature: "refused" },
  { stem: "unavailable", status: 503, nature: "unavailable" },
  { stem: "suspended", status: 403, nature: "refused" },
  { stem: "rejected", status: 400, nature: "refused" },
  { stem: "outdated", status: 412, nature: "refused" },
];

export const INVENTORY_FAMILIES = ["stock", "shelf", "supplier", "transfer"];
export const BILLING_FAMILIES = ["invoice", "payment", "refund", "tax"];
export const NOTIFY_FAMILIES = ["template", "delivery"];

export const API_EXTRA_ERROR_STEMS = [
  { stem: "quota_exhausted", status: 429, nature: "unavailable" },
  { stem: "maintenance_window", status: 503, nature: "unavailable" },
  { stem: "region_unavailable", status: 503, nature: "unavailable" },
  { stem: "client_outdated", status: 412, nature: "refused" },
  { stem: "feature_disabled", status: 403, nature: "refused" },
  { stem: "tenant_suspended", status: 403, nature: "refused" },
  { stem: "header_missing", status: 400, nature: "refused" },
  { stem: "clock_skew", status: 400, nature: "refused" },
  { stem: "filter_too_wide", status: 400, nature: "refused" },
  { stem: "locale_unsupported", status: 400, nature: "refused" },
] as const;

export const VALUE_SCHEMA_COUNT = 76;

// Value schemas are named an adjective and a noun; the first VALUE_SCHEMA_COUNT pairs in this order are used.
export const VALUE_ADJECTIVES = [
  "Gross",
  "Net",
  "Packed",
  "Loose",
  "Sealed",
  "Bonded",
  "Chilled",
  "Bulk",
  "Fragile",
];
export const VALUE_NOUNS = [
  "Weight",
  "Volume",
  "Span",
  "Count",
  "Window",
  "Rate",
  "Limit",
  "Tally",
  "Margin",
];
