import json
import math
import os
import tempfile
import unittest

from motion_bake import bake_points, load_resolved, move_for, settle_time, spring_offset

CFG = {
    "version": 1,
    "reducedFade": 0.15,
    "feels": {"whimsical": {"describe": "", "stagger": 0.065, "moves": {"move": {"visualDuration": 0.48, "bounce": 0.35, "reduced": "fade"}}}},
    "use": {"dialog": "whimsical"},
}


class MoveFor(unittest.TestCase):
    def test_touch_keeps_bounce(self):
        self.assertEqual(move_for(CFG, "whimsical", "move", True), {"visualDuration": 0.48, "bounce": 0.35})

    def test_no_touch_forces_bounce_zero(self):
        self.assertEqual(move_for(CFG, "dialog", "move", False)["bounce"], 0.0)

    def test_unknown_feel(self):
        with self.assertRaisesRegex(KeyError, 'unknown feel or surface "nope"'):
            move_for(CFG, "nope", "move", True)


class VersionTwo(unittest.TestCase):
    def test_v2_with_kinds_bakes_like_v1(self):
        v2 = {**CFG, "version": 2, "kinds": {"idle": {"period": 60}, "live": {"release": {"visualDuration": 0.5, "bounce": 0.2}}}}
        with tempfile.TemporaryDirectory() as d:
            paths = {}
            for name, cfg in (("v1", CFG), ("v2", v2)):
                paths[name] = os.path.join(d, f"{name}.json")
                with open(paths[name], "w", encoding="utf-8") as f:
                    json.dump(cfg, f)
            a, b = load_resolved(paths["v1"]), load_resolved(paths["v2"])
        self.assertEqual(move_for(a, "dialog", "move", True), move_for(b, "dialog", "move", True))
        m = move_for(b, "dialog", "move", True)
        self.assertEqual(bake_points(0.0, 1.0, m, fps=30), bake_points(0.0, 1.0, move_for(a, "dialog", "move", True), fps=30))

    def test_other_versions_still_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "c.json")
            with open(p, "w", encoding="utf-8") as f:
                json.dump({**CFG, "version": 3}, f)
            with self.assertRaisesRegex(ValueError, "version 1 or 2"):
                load_resolved(p)


class Spring(unittest.TestCase):
    def test_critically_damped_matches_closed_form(self):
        w0 = 2 * math.pi / (1.2 * 0.3)
        f = spring_offset(0.3, 0)
        for t in (0, 0.05, 0.1, 0.3):
            self.assertAlmostEqual(f(t, 1.0), math.exp(-w0 * t) * (1 + w0 * t), places=12)

    def test_settles(self):
        for b in (0, 0.15, 0.3, 0.4):
            self.assertLess(abs(spring_offset(0.3, b)(settle_time(0.3), 1.0)), 0.005)


class BakePoints(unittest.TestCase):
    def test_lands_exactly_and_counts_frames(self):
        pts = bake_points(0.0, 1.0, {"visualDuration": 0.3, "bounce": 0.3}, fps=30)
        self.assertEqual(pts[0], (0, 0.0))
        self.assertEqual(pts[-1], (math.ceil(settle_time(0.3) * 30), 1.0))

    def test_zero_distance_has_no_nan(self):
        pts = bake_points(2.0, 2.0, {"visualDuration": 0.3, "bounce": 0.3})
        self.assertTrue(all(x == 2.0 for _, x in pts))


if __name__ == "__main__":
    unittest.main()
