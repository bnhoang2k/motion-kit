/**
 * The static audit (no browser). A page opens from file://, so it cannot import `knob()`. It holds
 * its motion numbers in a `MOTION` const, and an adapted or invented page pastes the
 * `motion-kit knobs` block (a `KNOBS` const). The audit fails:
 *
 * - a duration, easing, spring or loop period typed as a literal outside `MOTION` and `KNOBS`. A copy
 *   of one of the kit's own bars skips this check (`literals: false`, see literalExemption): a copied
 *   bar keeps its own numbers. An adapted page runs it.
 * - every `setTimeout`, `setInterval`, `performance.now()` and `Date.now()` in page script, on every
 *   page, bar or not. They run on the wall clock, which the fixed clock cannot see. The check fails
 *   closed: a use passes only when its line carries one of two marker comments, `motion-kit:clock`
 *   (the page clock's own time read) or `motion-kit:not-motion` (a use that times no motion, such
 *   as a work budget).
 *
 * It also reports how far each `KNOBS` value sits from its base. Those lines are information only.
 *
 * The checks read the page's text, so they are a heuristic: a literal counts when it has a time
 * unit (`300ms`, `0.3s`), is an easing (`cubic-bezier(...)`, `ease-out`, `steps(4)`), or is a
 * non-zero number set on a name that holds a time or a spring (`fadeMs = 300`, `fadeMs = 300 * k`,
 * `{ duration: 300 }`, `stiffness: 200`), unless it combines with a `MOTION` or `KNOBS` value.
 */
export type AuditResult = {
    failures: string[];
    distances: string[];
};
/** A local script the page loads with `<script src>`, read by the caller. */
export type PageScript = {
    src: string;
    text: string;
};
export declare const CLOCK_MARKERS: readonly ["motion-kit:clock", "motion-kit:not-motion"];
/**
 * Whether the audit skips its literal check for this page. Only a copy of one of the kit's own bars does: the page's
 * `motion-kit-bar` marker names a slug, `readKitBar(slug)` returns that bar's index.html from the kit, and the page's
 * MOTION block is the same as the bar's, byte for byte. A page that names a bar and is not such a copy gets the check,
 * with a note that says why. A page with no marker gets the check and no note.
 */
export declare function literalExemption(html: string, readKitBar: (slug: string) => string | undefined): {
    exempt: boolean;
    note?: string;
};
/** `literals: false` skips the literal check (a copy of a kit bar, see literalExemption). */
export declare function audit(html: string, scripts?: PageScript[], { literals: literalCheck }?: {
    literals?: boolean;
}): AuditResult;
