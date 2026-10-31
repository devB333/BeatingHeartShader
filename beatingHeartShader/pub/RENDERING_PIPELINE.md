# Rendering pipeline

The current view is a monochrome WebGPU render of a 3D anatomical heart made from the characters of an editable poem. The text grid is fixed at **8 CSS pixels high**. Geometry is rendered at three times the grid resolution in each dimension before it becomes text.

## Pass order

| Stage | File | What it produces |
| --- | --- | --- |
| 1. Mesh | [mesh.wgsl](mesh.wgsl) | Rotated, beating heart geometry in a depth-tested `rgba16float` texture. RGB stores the surface normal; alpha stores linear depth. Empty pixels have zero alpha. |
| 2. Smoothing | [smooth.wgsl](smooth.wgsl) | A filtered normal and depth texture. A 7×7 joint bilateral filter uses a Gaussian spatial weight and reduces influence across depth and normal differences. It keeps the background empty. |
| 3. Lighting and edges | [contours.wgsl](contours.wgsl) | One value per text cell: soft lighting, edge direction, and a classification of empty space, heart interior, outer silhouette, or internal contour. |
| 4. Poem layout | [contours.js](contours.js), [layout.js](layout.js), [main.js](main.js) | The visible heart cells are read back from the GPU. The poem is assigned to those cells from left to right, then top to bottom. Short poems repeat; longer poems continue on additional pages. |
| 5. Glyph rendering | [shader.wgsl](shader.wgsl) | A full-screen pass samples the ASCII atlas and draws the assigned character in each occupied cell. |

## Filter details

**Bilateral smoothing.** The 7×7 filter has a Gaussian spatial term, `exp(-(x²+y²)/8)`. It also lowers the weight of samples with different depths or normals. This softens small mesh detail while preserving larger boundaries. There is no separate plain Gaussian blur pass.

**Sobel edges.** A 3×3 Sobel kernel measures gradients in all three surface-normal components and linear depth. The depth contribution is gated by local depth curvature so a smooth sloping surface does not become an edge everywhere. The pass uses non-maximum suppression and a strength threshold of `0.6` for internal edges. The silhouette is detected separately from occupied versus empty neighbors. Edge detection runs at three times the text grid resolution, then reduces the result to cells. There is no Canny pass.

**Lighting and tone bands.** Diffuse lighting and a small rim term are calculated from the smoothed normal. The final poem shader converts that lighting to **four brightness bands**. It gives shadowed letters a brightness floor, then slightly brightens letters on detected contours. The bands affect the brightness of the glyph ink, not which glyph is used.

## How the poem stays readable

The 3D heart controls the **mask**: a text cell is available when the projected heart covers it. [layout.js](layout.js) then places the poem in reading order across all available cells, including edge cells. On wider rows it attempts to wrap at word boundaries; narrow vessel rows can split words. Line breaks in the input become spaces. The poem repeats when there are more visible cells than characters.

The current poem render does **not** substitute `/`, `-`, or other edge characters for poem letters. The edge map only changes letter brightness. The ASCII glyph atlas supplies the visible pixels; no solid heart image is drawn underneath the text. As the heart beats or rotates, its visible mask can change and the poem reflows.

The shader still contains an eight-character density ramp (`.:-=+*#@`) from the comparison experiment, but the current app sets the **ordered poem mode** and has no render-mode control.
