// The silhouette alone determines poem placement. Edges never reserve cells.
// Alpha encodes background=0, poem=.5, silhouette=.75, internal edge=1.
export function contourLayout(pixels, columns, rows, stride) {
  const edges=[], slots=[];
  let internalEdges=0, outerEdges=0;
  for(let y=0;y<rows;y++) {
    const row=[];
    for(let x=0;x<columns;x++) {
      const kind=pixels[y*stride+x*4+3];
      if(kind<100)continue;
      if(kind>170) {
        edges.push(y*columns+x);
        if(kind>230)internalEdges++;else outerEdges++;
      }
      row.push(x);
    }
    slots.push(row);
  }
  return {slots,edges,internalEdges,outerEdges};
}
