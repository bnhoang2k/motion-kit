import { animate } from "motion";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { tx } from "../src/core/tx.ts";
import type { MotionConfig } from "../src/core/types.ts";
import { browserScheduler, tween, type Scheduler, type Tween } from "../src/three/index.ts";

/** `feel` is the selected lane. A lane with no engine numbers (a preview-only candidate) plays sleek, and the rows say so. */
interface Opts { cfg: MotionConfig; feel: () => string; reduced: () => boolean }

/** Adds one engine row. Returns its note, so the caller can update it. */
function row(root: HTMLElement, name: string, note: string, el: HTMLElement): HTMLElement {
  const r = document.createElement("div");
  r.className = "engine";
  const label = document.createElement("div");
  label.className = "name";
  label.dataset.uiAlignItem = "";
  label.textContent = name;
  const small = Object.assign(document.createElement("small"), { textContent: note });
  label.append(small);
  r.append(label, el);
  root.append(r);
  return small;
}

function scene(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  const s = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  cam.position.set(0, 0, 5);
  const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#2f6fde" }));
  s.add(box);
  // Match the DOM row: a 32 px piece whose center runs from 32 px to (width - 32) px, so world x = -1 to 1.
  const draw = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    const unit = 2 / Math.max(1, w - 64);
    cam.left = -1 - 32 * unit;
    cam.right = 1 + 32 * unit;
    cam.top = (h / 2) * unit;
    cam.bottom = -cam.top;
    cam.updateProjectionMatrix();
    box.scale.setScalar(32 * unit);
    renderer.render(s, cam);
  };
  new ResizeObserver(() => draw()).observe(canvas);
  return { box, draw };
}

/** Three rows that play the selected feel's "move": DOM (Motion), three.js (tween) and a Blender clip. */
export function mountEngines(root: HTMLElement, opts: Opts): { play(byTouch: boolean): void } {
  root.replaceChildren();

  const domStage = document.createElement("div");
  domStage.className = "stage";
  const dot = Object.assign(document.createElement("div"), { className: "piece" });
  Object.assign(dot.style, { left: "16px", top: "32px", width: "32px", height: "32px" });
  domStage.append(dot);
  const domNote = row(root, "Motion", "DOM", domStage);

  const threeCanvas = document.createElement("canvas");
  const threeNote = row(root, "three.js", "tween()", threeCanvas);
  const three = scene(threeCanvas);
  three.box.position.x = -1;
  three.draw();
  let job: Tween | undefined;
  // One scheduler that reads the Reduced-motion switch live, so a retarget sees the current value.
  const sched: Scheduler = { ...browserScheduler(), reduced: () => opts.reduced() };

  const clipCanvas = document.createElement("canvas");
  const clipNote = row(root, "Blender", "baked from defaults", clipCanvas);
  const notes = { dom: "DOM", three: "tween()", clip: "baked from defaults" };
  const clip = scene(clipCanvas);
  clip.box.position.x = -1;
  clip.draw();
  const probe = new THREE.Object3D();
  probe.name = "probe";
  const mixer = new THREE.AnimationMixer(probe);
  const clips = new Map<string, THREE.AnimationClip>();
  const loader = new GLTFLoader();
  let clipFrame = 0;
  let seq = 0;

  /** A touch clip keeps the feel's bounce. A no-touch clip, for a server event, has none. */
  const loadClip = async (feel: string, byTouch: boolean): Promise<THREE.AnimationClip | undefined> => {
    const key = byTouch ? feel : `${feel}-notouch`;
    if (clips.has(key)) return clips.get(key);
    try {
      const gltf = await loader.loadAsync(`./assets/sample-${key}.glb`);
      const c = gltf.animations[0];
      if (c) clips.set(key, c);
      return c;
    } catch {
      return undefined;
    }
  };

  return {
    play(byTouch) {
      const asked = opts.feel();
      const feel = Object.hasOwn(opts.cfg.feels, asked) ? asked : Object.hasOwn(opts.cfg.feels, "sleek") ? "sleek" : Object.keys(opts.cfg.feels)[0]!;
      const suffix = feel === asked ? "" : ` · plays ${feel}, not ${asked}`;
      domNote.textContent = notes.dom + suffix;
      threeNote.textContent = notes.three + suffix;
      clipNote.textContent = notes.clip + suffix;
      const mine = ++seq;
      cancelAnimationFrame(clipFrame); // the old step loop must not write after this tap
      const s = tx(opts.cfg, feel, "move", { byTouch });
      const reduced = opts.reduced();
      const goingRight = three.box.position.x < 0;
      const toX = goingRight ? 1 : -1;
      // The clip runs 0 to 1. Map it from where the box is now, so a tap mid-flight does not jump.
      const fromClipX = clip.box.position.x;
      const clipX = (p: number) => fromClipX + (toX - fromClipX) * p;

      const spring = { type: "spring" as const, visualDuration: s.visualDuration, bounce: s.bounce };
      void animate(dot, { x: goingRight ? domStage.clientWidth - 64 : 0 }, reduced ? { duration: 0 } : spring);

      if (job && !job.done) job.retarget(toX, s);
      else job = tween({ from: three.box.position.x, to: toX, spring: s, reducedFade: opts.cfg.reducedFade, onUpdate: (x) => { three.box.position.x = x; three.draw(); } }, sched);

      void loadClip(feel, byTouch).then((c) => {
        if (mine !== seq) return; // a newer tap owns the clip now
        if (!c) {
          clipNote.textContent = "No sample for this feel" + suffix;
          return;
        }
        mixer.stopAllAction();
        const action = mixer.clipAction(c);
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.reset().play();
        if (reduced) {
          action.time = c.duration;
          mixer.update(0);
          clip.box.position.x = clipX(probe.position.x);
          clip.draw();
          return;
        }
        let last = performance.now();
        const step = (now: number) => {
          // A frame time can come before `last`. A negative step would end a LoopOnce clip at once.
          mixer.update(Math.max(0, now - last) / 1000);
          last = now;
          clip.box.position.x = clipX(probe.position.x);
          clip.draw();
          if (action.isRunning()) clipFrame = requestAnimationFrame(step);
        };
        clipFrame = requestAnimationFrame(step);
      });
    },
  };
}
