// Runs the profile of the pack the consumer's contract applies against the server the overlay starts, writes its
// report to `reports/`, and passes one test per case: passed, or refused by name.
import { describePackProfile } from "./suite-run.mjs";

describePackProfile();
