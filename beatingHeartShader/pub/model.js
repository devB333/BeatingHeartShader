export function decodeHeart(buffer) {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) throw Error('Invalid GLB');
  const length = view.getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length)));
  const binaryStart = 28 + length;
  function accessor(index) {
    const a = gltf.accessors[index], b = gltf.bufferViews[a.bufferView];
    const components = a.type === 'VEC3' ? 3 : 1;
    const bytes = a.componentType === 5123 ? 2 : 4;
    const output = new (a.componentType === 5126 ? Float32Array : Uint32Array)(a.count * components);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < components; c++) {
      const offset = binaryStart + (b.byteOffset || 0) + (a.byteOffset || 0) + i * (b.byteStride || components * bytes) + c * bytes;
      output[i * components + c] = a.componentType === 5126 ? view.getFloat32(offset, true) : bytes === 2 ? view.getUint16(offset, true) : view.getUint32(offset, true);
    }
    return output;
  }
  const parts = [];
  for (const node of gltf.nodes) {
    if (node.mesh === undefined) continue;
    if (node.matrix || node.translation || node.rotation || node.scale) throw Error('This loader expects baked model transforms');
    for (const p of gltf.meshes[node.mesh].primitives) {
      if (p.extensions || (p.mode !== undefined && p.mode !== 4)) throw Error('Unsupported mesh encoding');
      parts.push({ positions: accessor(p.attributes.POSITION), normals: accessor(p.attributes.NORMAL), indices: accessor(p.indices) });
    }
  }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) for (let i = 0; i < part.positions.length; i++) {
    min[i % 3] = Math.min(min[i % 3], part.positions[i]); max[i % 3] = Math.max(max[i % 3], part.positions[i]);
  }
  const scale = 2 / Math.max(...max.map((v, i) => v - min[i]));
  return parts.map(part => {
    const vertices = new Float32Array(part.positions.length * 2);
    for (let i = 0; i < part.positions.length / 3; i++) for (let c = 0; c < 3; c++) {
      vertices[i * 6 + c] = (part.positions[i * 3 + c] - (min[c] + max[c]) / 2) * scale;
      vertices[i * 6 + c + 3] = part.normals[i * 3 + c];
    }
    return { vertices, indices: part.indices };
  });
}
