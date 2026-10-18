"""Bake motion-kit springs into Blender keys.

The math has no bpy import, so it runs in plain Python tests.
Read numbers from `motion-kit resolve --out motion.resolved.json`, never from motion.json directly:
only the resolved file has the package defaults merged in.
"""
import json
import math

MIN_DAMPING = 0.05


def load_resolved(path):
    with open(path, encoding="utf-8") as f:
        cfg = json.load(f)
    if cfg.get("version") != 1:
        raise ValueError(f"{path}: expected a resolved motion config with version 1")
    return cfg


def move_for(cfg, feel, move, by_touch):
    """The numbers for one move. Bounce only answers a touch."""
    name = cfg.get("use", {}).get(feel, feel)
    if name not in cfg["feels"]:
        raise KeyError(f'unknown feel or surface "{feel}"')
    m = cfg["feels"][name]["moves"][move]
    return {"visualDuration": m["visualDuration"], "bounce": m["bounce"] if by_touch else 0.0}


def spring_offset(visual_duration, bounce):
    """Offset from the target at time t (s), from rest at offset e0. Motion's mapping."""
    w0 = 2 * math.pi / (1.2 * visual_duration)
    z = max(1 - bounce, MIN_DAMPING)
    if z < 1:
        wd = w0 * math.sqrt(1 - z * z)
        return lambda t, e0: math.exp(-z * w0 * t) * (e0 * math.cos(wd * t) + (z * w0 * e0 / wd) * math.sin(wd * t))
    return lambda t, e0: math.exp(-w0 * t) * (e0 + w0 * e0 * t)


def settle_time(visual_duration):
    return 1.8 * visual_duration


def bake_points(x0, x1, spring, fps=30):
    """(frame offset, value) pairs, one per frame. The last one lands exactly on x1."""
    f = spring_offset(spring["visualDuration"], spring["bounce"])
    n = max(1, math.ceil(settle_time(spring["visualDuration"]) * fps))
    return [(i, x1 if i == n else x1 + f(i / fps, x0 - x1)) for i in range(n + 1)]


def bake_property(obj, data_path, index, frame_start, x0, x1, spring, fps=30):
    """Writes one key per frame on obj.<data_path>[index]. Returns the last frame.

    Set bpy.context.preferences.edit.keyframe_new_interpolation_type = 'LINEAR' first.
    glTF carries only LINEAR, STEP and CUBICSPLINE, so baked LINEAR keys are what survive export.
    """
    last = frame_start
    for i, x in bake_points(x0, x1, spring, fps):
        getattr(obj, data_path)[index] = x
        obj.keyframe_insert(data_path=data_path, index=index, frame=frame_start + i)
        last = frame_start + i
    return last
