interface Accessor { bufferView: number; byteOffset?: number; count: number; type: "SCALAR" | "VEC3" | "VEC4" }
interface BufferView { byteOffset?: number; byteStride?: number }
interface Gltf {
  nodes: { name?: string }[];
  accessors: Accessor[];
  bufferViews: BufferView[];
  animations: { channels: { sampler: number; target: { node: number; path: string } }[]; samplers: { input: number; output: number }[] }[];
}

/** Reads the X translation track of one node from a GLB's first animation. */
export function readTranslationX(glb: Buffer, node: string): { times: number[]; x: number[] } {
  const jsonLen = glb.readUInt32LE(12);
  const gltf = JSON.parse(glb.subarray(20, 20 + jsonLen).toString("utf8")) as Gltf;
  const bin = glb.subarray(20 + jsonLen + 8);
  const nodeIndex = gltf.nodes.findIndex((n) => n.name === node);
  const anim = gltf.animations[0];
  const ch = anim?.channels.find((c) => c.target.node === nodeIndex && c.target.path === "translation");
  if (!anim || !ch) throw new Error(`no translation track for node "${node}"`);
  const sampler = anim.samplers[ch.sampler]!;
  const read = (ai: number, comp: number): number[] => {
    const acc = gltf.accessors[ai]!;
    const bv = gltf.bufferViews[acc.bufferView]!;
    const width = { SCALAR: 1, VEC3: 3, VEC4: 4 }[acc.type];
    const stride = bv.byteStride ?? width * 4;
    const off = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    return Array.from({ length: acc.count }, (_, i) => bin.readFloatLE(off + i * stride + comp * 4));
  };
  return { times: read(sampler.input, 0), x: read(sampler.output, 0) };
}
