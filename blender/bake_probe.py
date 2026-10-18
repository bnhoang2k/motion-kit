"""Headless: bake one move onto a cube named "probe" (X from 0 to 1) and export a GLB.

blender -b --factory-startup --python blender/bake_probe.py -- <resolved.json> <out.glb> <feel> <move> [touch|notouch]

The optional last argument says whether a touch caused the move: `touch` (the default, the move keeps its bounce) or `notouch`.
Anything else exits with an error.
"""
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from motion_bake import bake_property, load_resolved, move_for  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1:]
cfg_path, out_path, feel, move = args[:4]
touch_arg = args[4] if len(args) > 4 else "touch"
if len(args) not in (4, 5) or touch_arg not in ("touch", "notouch"):
    sys.exit("bake_probe.py: expected <resolved.json> <out.glb> <feel> <move> [touch|notouch]")
by_touch = touch_arg == "touch"

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
scene = bpy.context.scene
scene.render.fps = 30
bpy.ops.mesh.primitive_cube_add(size=0.2)
probe = bpy.context.active_object
probe.name = "probe"
probe.location = (0.0, 0.0, 0.0)

end = bake_property(probe, "location", 0, 1, 0.0, 1.0, move_for(load_resolved(cfg_path), feel, move, by_touch), fps=30)
probe.animation_data.action.name = f"{feel}-{move}" + ("" if by_touch else "-notouch")
scene.frame_start, scene.frame_end = 1, end

bpy.ops.export_scene.gltf(
    filepath=out_path,
    export_format="GLB",
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_force_sampling=True,
)
