import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contourLayout } from './contours.js';
import { layoutText } from './layout.js';
test('edges do not remove or reorder poem cells inside the silhouette',()=>{
  const width=20, height=16, stride=width*4;
  const pixels=new Uint8Array(stride*height);
  for(let y=2;y<14;y++)for(let x=2;x<18;x++) {
    const border=x===2||x===17||y===2||y===13;
    const groove=x===10&&y>4&&y<11;
    pixels.set([150,128,255,groove?255:border?191:128],y*stride+x*4);
  }
  const {slots,edges,internalEdges,outerEdges}=contourLayout(pixels,width,height,stride);
  assert.equal(internalEdges,6);
  assert.ok(outerEdges>0);
  assert.ok(edges.includes(8*width+10));
  assert.ok(edges.includes(2*width+2));
  assert.ok(slots[8].includes(8));
  assert.ok(slots[8].includes(10), 'internal contour must still contain poem text');
  assert.ok(slots[2].includes(2), 'silhouette contour must still contain poem text');
  assert.equal(slots.flat().length,16*12);
  const {pages}=layoutText('SOBEL KEEPS EVERY LETTER',slots,width);
  const withoutEdges=pixels.slice();
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const alpha=y*stride+x*4+3;
    if(withoutEdges[alpha])withoutEdges[alpha]=128;
  }
  const plainSlots=contourLayout(withoutEdges,width,height,stride).slots;
  assert.deepEqual(layoutText('SOBEL KEEPS EVERY LETTER',plainSlots,width).pages,pages,
    'changing edge detection must not change any poem characters or positions');
  const visible=Array.from(pages[0]).filter(c=>c>32).map(c=>String.fromCharCode(c)).join('');
  assert.ok(visible.startsWith('SOBELKEEPSEVERYLETTER'));
});
