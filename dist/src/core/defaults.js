export const DEFAULTS = {
    version: 1,
    reducedFade: 0.15,
    feels: {
        calm: {
            describe: "Quiet: no bounce, unhurried, for tools people glance at.",
            stagger: 0.04,
            moves: {
                tap: { visualDuration: 0.15, bounce: 0, amount: 0.97, reduced: "instant" },
                enter: { visualDuration: 0.38, bounce: 0, reduced: "fade" },
                exit: { visualDuration: 0.23, bounce: 0, reduced: "fade" },
                move: { visualDuration: 0.38, bounce: 0, reduced: "fade" },
                attention: { visualDuration: 0.3, bounce: 0, amount: 1.08, reduced: "instant" },
                celebrate: { visualDuration: 0.53, bounce: 0, reduced: "fade" },
            },
        },
        sleek: {
            describe: "Fast and smooth: a bounce you feel more than see.",
            stagger: 0.025,
            moves: {
                tap: { visualDuration: 0.1, bounce: 0.05, amount: 0.97, reduced: "instant" },
                enter: { visualDuration: 0.25, bounce: 0.05, reduced: "fade" },
                exit: { visualDuration: 0.15, bounce: 0, reduced: "fade" },
                move: { visualDuration: 0.25, bounce: 0.05, reduced: "fade" },
                attention: { visualDuration: 0.2, bounce: 0.05, amount: 1.08, reduced: "instant" },
                celebrate: { visualDuration: 0.35, bounce: 0.05, reduced: "fade" },
            },
        },
        snappy: {
            describe: "Quick and crisp: a small, visible settle.",
            stagger: 0.02,
            moves: {
                tap: { visualDuration: 0.07, bounce: 0.15, amount: 0.95, reduced: "instant" },
                enter: { visualDuration: 0.16, bounce: 0.15, reduced: "fade" },
                exit: { visualDuration: 0.1, bounce: 0, reduced: "fade" },
                move: { visualDuration: 0.16, bounce: 0.15, reduced: "fade" },
                attention: { visualDuration: 0.13, bounce: 0.15, amount: 1.08, reduced: "instant" },
                celebrate: { visualDuration: 0.22, bounce: 0.15, reduced: "fade" },
            },
        },
        whimsical: {
            describe: "Playful: a clear bounce on touch, staggered arrivals.",
            stagger: 0.065,
            moves: {
                tap: { visualDuration: 0.15, bounce: 0.35, amount: 0.95, reduced: "instant" },
                enter: { visualDuration: 0.48, bounce: 0.35, reduced: "fade" },
                exit: { visualDuration: 0.29, bounce: 0, reduced: "fade" },
                move: { visualDuration: 0.48, bounce: 0.35, reduced: "fade" },
                attention: { visualDuration: 0.38, bounce: 0.35, amount: 1.1, reduced: "instant" },
                celebrate: { visualDuration: 0.67, bounce: 0.35, reduced: "fade" },
            },
        },
    },
};
