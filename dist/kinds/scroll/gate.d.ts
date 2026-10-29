import { type GatePage } from "../../src/gate/harness.ts";
import { type KindRule, type RuleContext } from "../../src/gate/kind-gate.ts";
/** A scroll page with a loop gets the idle rules for it: it pauses off screen and resumes within one frame. */
export declare const rules: KindRule[];
/** The stepped values `scroll` judges inside the input window, which the envelope rule leaves to it. */
export declare const inputLeads: (page: GatePage, ctx: RuleContext) => Promise<import("../../src/gate/leads.ts").LeadWindow>;
