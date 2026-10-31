import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeHeart } from './model.js';
test('bundled anatomical GLB decodes to finite, indexed 3D geometry',()=>{
  const bytes=readFileSync(new URL('./assets/heart.glb',import.meta.url));
  const parts=decodeHeart(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  assert.equal(parts.length,11);
  let triangles=0;
  for(const p of parts) {
    assert.ok(p.vertices.every(Number.isFinite));
    assert.ok(p.indices.every(i=>i<p.vertices.length/6));
    triangles+=p.indices.length/3;
  }
  assert.ok(triangles>10000);
});
