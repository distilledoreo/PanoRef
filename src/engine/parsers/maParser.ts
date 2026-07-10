/**
 * Minimal Maya ASCII (.ma) parser for geometry-only import.
 * No eval, no material/texture/animation handling.
 * Supports:
 *  - currentUnit -l <unit> for cm→m conversion
 *  - createNode transform -n "name" -p "parent"
 *  - createNode mesh -n "shapeName" -p "parentTransform"
 *  - setAttr ".t" -type "double3" x y z
 *  - setAttr ".tx" / ".ty" / ".tz", ".rx/.ry/.rz", ".sx/.sy/.sz" (single)
 *  - setAttr -s N ".vt[0:N]" -type "float3" x y z ...
 *  - setAttr -s M ".fc[0:M]" -type "polyFaces" f N i0 i1... [mu ...] ...
 */

export type Vec3Tuple = [number, number, number];

export interface MaTransformRaw {
  name: string;
  parentName?: string;
  translation: Vec3Tuple;
  rotation: Vec3Tuple; // degrees XYZ
  scale: Vec3Tuple;
}

export interface MaMeshRaw {
  name: string;
  parentName?: string;
  vertices: Vec3Tuple[]; // local space before unit scale
  faces: number[][]; // each polygon = list of vertex indices
}

export interface MaScene {
  unit: string;
  unitScale: number;
  transforms: Map<string, MaTransformRaw>;
  meshes: Map<string, MaMeshRaw>;
  warnings: string[];
}

const UNIT_SCALES: Record<string, number> = {
  mm: 0.001,
  millimeter: 0.001,
  Millimeters: 0.001,
  cm: 0.01,
  centimeter: 0.01,
  Centimeters: 0.01,
  m: 1,
  meter: 1,
  Meters: 1,
  km: 1000,
  kilometer: 1000,
  in: 0.0254,
  inch: 0.0254,
  Inches: 0.0254,
  ft: 0.3048,
  foot: 0.3048,
  Feet: 0.3048,
  yd: 0.9144,
  yard: 0.9144,
};

function extractNumbers(str: string): number[] {
  const re = /[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g;
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(str)) !== null) {
    const v = Number(m[0]);
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

function extractDouble3Values(stmt: string): number[] {
  // Prefer numbers after -type "double3"
  const typeMatch = stmt.match(/-type\s+"[^"]+"\s*([^;]*)/s);
  const afterType = typeMatch ? typeMatch[1] : stmt;
  return extractNumbers(afterType);
}

function extractVtValues(stmt: string): number[] {
  const typeMatch = stmt.match(/-type\s+"[^"]+"\s*([^;]*)/s);
  const afterType = typeMatch ? typeMatch[1] : stmt;
  return extractNumbers(afterType);
}

function attrNameFromSetAttr(line: string): string | undefined {
  const q = line.match(/"(\.[^\"]+)"/);
  if (!q) return undefined;
  // q[1] may be like .vt[0:7] or .t
  // we want base name without indices: .vt, .fc, .t etc.
  const raw = q[1];
  const base = raw.match(/^(\.[a-zA-Z]+)/);
  return base ? base[1] : raw.split('[')[0];
}

function parseCurrentUnit(text: string): { unit: string; scale: number } {
  const re = /currentUnit[^\n]*-l\s+([A-Za-z]+)/g;
  let lastUnit = 'cm';
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    lastUnit = m[1];
  }
  const scale = UNIT_SCALES[lastUnit] ?? UNIT_SCALES[lastUnit.toLowerCase()] ?? 0.01;
  // default maya cm
  return { unit: lastUnit, scale };
}

function parsePolyFaces(data: string, expectedFaces: number, warnings: string[]): number[][] {
  // data is substring after -type "polyFaces" up to ;
  const trimmed = data.split(';')[0].trim();
  // tokenise: keep 'f' and 'mu' etc as tokens, and numbers.
  // split by whitespace, but we need to keep tokens like 'f'
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const faces: number[][] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === 'f' || t.toLowerCase() === 'f') {
      // next token is vertex count
      const countStr = tokens[i + 1];
      if (!countStr) break;
      const count = parseInt(countStr, 10);
      if (!Number.isFinite(count) || count < 3) {
        warnings.push(`Skipped invalid polyFace count "${countStr}".`);
        i += 2;
        continue;
      }
      const verts: number[] = [];
      for (let k = 0; k < count; k++) {
        const idxStr = tokens[i + 2 + k];
        if (idxStr === undefined) break;
        const idx = parseInt(idxStr, 10);
        if (!Number.isFinite(idx)) {
          warnings.push(`Invalid vertex index "${idxStr}" in polyFaces.`);
          break;
        }
        verts.push(idx);
      }
      if (verts.length === count) {
        faces.push(verts);
      } else {
        warnings.push(`Incomplete face definition, expected ${count} indices.`);
      }
      i += 2 + count;
      // now skip optional mu / uv mappings: common pattern "mu v0 v1..."
      // After a face, there may be "mu <count> ...", we skip if present.
      while (i < tokens.length && tokens[i] !== 'f' && tokens[i] !== 'F') {
        const tok = tokens[i];
        if (tok === 'mu' || tok === 'mf' || tok === 'mh' || tok === 'mu ' || tok.startsWith('m')) {
          // Heuristic: if tok is exactly 'mu', then next `count` tokens are uv indices - skip them.
          // If tok is 'mu' we skip it + count numbers.
          if (tok === 'mu' || tok === 'mf') {
            i++; // skip 'mu'
            // skip `count` numbers that correspond to face verts
            let skipped = 0;
            while (skipped < count && i < tokens.length && /^-?\d+$/.test(tokens[i])) {
              i++;
              skipped++;
            }
            continue;
          }
          // Generic map token: skip token + attempt to skip numbers until next 'f' or next alpha token
          if (/^[a-zA-Z]+$/.test(tok) && tok !== 'f') {
            i++;
            // skip following numbers same count?
            let numSkipped = 0;
            while (i < tokens.length && /^-?\d+$/.test(tokens[i]) && numSkipped < count) {
              i++;
              numSkipped++;
            }
            continue;
          }
        }
        // If token is numeric but not part of face (leftover), break if we encounter 'f' next?
        // If we encounter something that looks like a number but we already consumed face, it likely belongs to next face's structure incorrectly.
        // To avoid infinite loop, if token is not 'f', we just skip numeric tokens.
        if (/^-?\d+$/.test(tok)) {
          i++;
          continue;
        }
        // Unknown token - skip
        i++;
        // stop skipping if next is 'f'
        if (i < tokens.length && (tokens[i] === 'f' || tokens[i] === 'F')) break;
      }
    } else if (/^\d+$/.test(t) || t.startsWith('-')) {
      // stray number outside f - skip
      i++;
    } else {
      // skip other keywords (e.g., "setAttr", "h" hole marker)
      if (t === 'h') {
        // holes: next tokens may describe hole polygon, skip similar to face?
        i++;
        continue;
      }
      i++;
    }
  }
  if (expectedFaces > 0 && faces.length !== expectedFaces) {
    warnings.push(`Expected ${expectedFaces} faces but parsed ${faces.length}.`);
  }
  return faces;
}

export function parseMaText(text: string): MaScene {
  const warnings: string[] = [];
  const { unit, scale: unitScale } = parseCurrentUnit(text);
  const transforms = new Map<string, MaTransformRaw>();
  const meshes = new Map<string, MaMeshRaw>();

  // Pre-process: join multiline setAttr that ends with ';' across lines
  // We'll iterate scanning for createNode and setAttr statements via regex over whole text keeping index.

  interface NodeSpan {
    type: string;
    name: string;
    parentName?: string;
    start: number;
    end: number;
  }
  const nodes: NodeSpan[] = [];
  let m: RegExpExecArray | null;
  const simpleNodeRe = /createNode\s+(\w+)[^\n]*-n\s+"([^"]+)"[^\n]*;/g;
  while ((m = simpleNodeRe.exec(text)) !== null) {
    const full = m[0];
    const type = m[1];
    const name = m[2];
    const parentMatch = full.match(/-p\s+"([^"]+)"/);
    const parentName = parentMatch?.[1];
    nodes.push({ type, name, parentName, start: m.index, end: m.index + full.length });
  }

  // Also need to handle setAttr regions between nodes
  // We'll walk nodes in order, and for each node, look at text segment until next node's start.
  nodes.sort((a, b) => a.start - b.start);

  for (let idx = 0; idx < nodes.length; idx++) {
    const node = nodes[idx];
    const segmentStart = node.end;
    const segmentEnd = idx + 1 < nodes.length ? nodes[idx + 1].start : text.length;
    const segment = text.slice(segmentStart, segmentEnd);

    if (node.type === 'transform') {
      let tr = transforms.get(node.name);
      if (!tr) {
        tr = {
          name: node.name,
          parentName: node.parentName,
          translation: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        };
        transforms.set(node.name, tr);
      } else {
        if (node.parentName) tr.parentName = node.parentName;
      }
      // parse setAttr in segment
      const setAttrRe = /setAttr\s+[^;]*;/gs;
      let sm: RegExpExecArray | null;
      while ((sm = setAttrRe.exec(segment)) !== null) {
        const stmt = sm[0];
        const attr = attrNameFromSetAttr(stmt);
        if (!attr) continue;
        if (attr === '.t' || attr === '.r' || attr === '.s' || attr === '.tx' || attr === '.ty' || attr === '.tz' || attr === '.rx' || attr === '.ry' || attr === '.rz' || attr === '.sx' || attr === '.sy' || attr === '.sz') {
          const nums = extractDouble3Values(stmt);
          if (attr === '.t' && nums.length >= 3) {
            tr.translation = [nums[0], nums[1], nums[2]];
          } else if (attr === '.r' && nums.length >= 3) {
            tr.rotation = [nums[0], nums[1], nums[2]];
          } else if (attr === '.s' && nums.length >= 3) {
            tr.scale = [nums[0], nums[1], nums[2]];
          } else if (attr === '.tx' && nums.length >= 1) {
            tr.translation[0] = nums[0];
          } else if (attr === '.ty' && nums.length >= 1) {
            tr.translation[1] = nums[0];
          } else if (attr === '.tz' && nums.length >= 1) {
            tr.translation[2] = nums[0];
          } else if (attr === '.rx' && nums.length >= 1) {
            tr.rotation[0] = nums[0];
          } else if (attr === '.ry' && nums.length >= 1) {
            tr.rotation[1] = nums[0];
          } else if (attr === '.rz' && nums.length >= 1) {
            tr.rotation[2] = nums[0];
          } else if (attr === '.sx' && nums.length >= 1) {
            tr.scale[0] = nums[0];
          } else if (attr === '.sy' && nums.length >= 1) {
            tr.scale[1] = nums[0];
          } else if (attr === '.sz' && nums.length >= 1) {
            tr.scale[2] = nums[0];
          }
        }
      }
    } else if (node.type === 'mesh') {
      const mr = meshes.get(node.name) ?? {
        name: node.name,
        parentName: node.parentName,
        vertices: [],
        faces: [],
      };
      mr.parentName = node.parentName ?? mr.parentName;
      // setAttr scanning
      const setAttrRe = /setAttr\s+[^;]*;/gs;
      let sm: RegExpExecArray | null;
      while ((sm = setAttrRe.exec(segment)) !== null) {
        const stmt = sm[0];
        const attr = attrNameFromSetAttr(stmt);
        if (!attr) continue;
        const lower = attr.toLowerCase();
        if (lower === '.vt' || lower === '.v' || lower.startsWith('.vt[') || lower.startsWith('.v[') || attr === '.vt' || attr.startsWith('.vt[')) {
          if (!stmt.includes('float3') && !stmt.includes('double3')) continue;
          const sizeMatch = stmt.match(/-s\s+(\d+)/);
          const expectedCount = sizeMatch ? parseInt(sizeMatch[1], 10) : 0;
          const vertNums = extractVtValues(stmt);
          // vertNums length should be expectedCount*3
          if (expectedCount > 0 && vertNums.length < expectedCount * 3) {
            warnings.push(`Mesh ${node.name} ".vt" expected ${expectedCount * 3} numbers but got ${vertNums.length}.`);
          }
          const verts: Vec3Tuple[] = [];
          for (let i = 0; i + 2 < vertNums.length; i += 3) {
            verts.push([vertNums[i], vertNums[i + 1], vertNums[i + 2]]);
          }
          if (verts.length > 0) {
            // If size known, trim/pad
            mr.vertices = expectedCount > 0 ? verts.slice(0, expectedCount) : verts;
          }
        } else if (attr === '.fc' || attr.startsWith('.fc[') || lower === '.fc' || attr === '.f' || attr.startsWith('.f[') || attr === '.fc' || attr.startsWith('.fc')) {
          // polyFaces
          const sizeMatch = stmt.match(/-s\s+(\d+)/);
          const expectedFc = sizeMatch ? parseInt(sizeMatch[1], 10) : 0;
          const afterType = stmt.split(/-type\s+"[^"]+"\s*/)[1] ?? '';
          const parsed = parsePolyFaces(afterType, expectedFc, warnings);
          if (parsed.length > 0) mr.faces = parsed;
        }
      }
      meshes.set(node.name, mr);
    }
  }

  // Also handle global currentUnit already done

  return { unit, unitScale, transforms, meshes, warnings };
}
