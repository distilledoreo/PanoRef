# Projection Assist

Projection Assist corrects a styled panorama where coherent visual regions do not line up with the matching graybox. The recommended method is **Region Fit**. It deforms only the selected region and its narrow, softened transition—not unrelated walls, floors, posts, or furniture.

## Region Fit workflow

1. Import a styled panorama and a graybox panorama captured from the same position.
2. Open **Reference → Precision → Projected Style → Projection Assist** and choose **Add region** for the applicable primary or secondary panorama.
3. In **Graybox**, choose **Polygon** and draw around the region where it should fit. Click the first handle, double-click, or press Enter to close it. **Rectangle** provides a four-handle quick start.
4. PanoRef automatically creates the identical outline in **Styled**, preserving every handle ID, its order, and its paired edge. The styled outline starts at the graybox coordinates; never redraw it independently.
5. Move, scale, or rotate the styled outline, then drag individual handles around the matching styled content. Shift-click selects multiple handles. Double-click a handle to insert a paired handle on its outgoing edge; Delete removes the selected paired handle. An outline cannot fall below three handles.
6. In **Review**, save the region, adjust **Edge softness**, rename or disable it, and move it up or down. Later regions appear above earlier overlapping regions.
7. Add separate regions for separate coherent surfaces. For example, correct a canopy, rear wall, floor, chair, and curtains independently instead of asking one global correction to reconcile all five.
8. Choose **Preview** for the draft-local geometry result. Adjust overall strength, then **Apply** to persist or **Cancel** to leave the saved project unchanged.

On phones the editor progresses automatically through **Graybox → Styled → Review**. Both panorama viewers share their viewing orientation. Changing the styled or graybox panorama while a draft is dirty requires confirmation.

## Paired topology and persistence

Each region stores one ordered `vertices` collection. Every vertex record contains a shared ID plus its graybox and styled positions, so the two outlines cannot diverge in vertex count, order, winding, connectivity, or starting point. Insertion and deletion always modify the pair together.

Region Fits are stored in `settings.projectedStyle.regionAlignments`. At most one alignment belongs to each source panorama. Primary and secondary slots resolve their own source-owned entries independently; changing blend mode does not transfer or merge them. Invalid saved regions remain available for repair but do not run.

## Rendering and precedence

Region Fit converts both paired outlines through their panorama yaw into one world-angular fitting plane. The target interior maps through shared triangle indices to the styled interior. An identity outer cage blends the mapping back to the untouched panorama according to Edge softness.

The same cached displacement and weight textures are used by:

- the live projected viewport;
- projected stills;
- camera-move frames and MP4 output; and
- projected package stills, frames, and MP4 files.

Overall strength is applied in the shader and is excluded from the texture cache key. Moving the strength slider therefore does not regenerate the mapping. Later overlapping regions replace earlier mappings deterministically instead of averaging incompatible results.

For a source panorama, runtime precedence is:

1. a valid enabled Region Fit;
2. legacy point correction; or
3. natural projection.

The two correction methods are never combined. When Region Fit is active, the editor reports that legacy point correction is inactive.

## Safety and limits

Region Fit is an angular image correction, not 3D reconstruction or inpainting. Styled and graybox capture origins must be within 0.25 m. Yaw differences are supported. A region spanning more than 100 degrees, crossing itself, approaching an unstable pole, passing behind its tangent plane, or producing folded/collapsed triangles is blocked with repair guidance.

Large capture-origin changes, missing geometry, disoccluded pixels, mask holes, brush masks, AI segmentation, and generative filling are outside the first release.

## Legacy point correction

The previous point-driven spherical correction remains under **Advanced → Legacy point correction** and is labeled **Experimental · intended for very small local nudges**. It is not the recommended workflow because multiple point pairs can pull unrelated structures between intended correction areas.
