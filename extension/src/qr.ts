/**
 * A small QR Code encoder, so pairing can show the server address and the
 * six-digit code in one scannable image.
 *
 * The extension ships with no runtime dependencies, and a QR library would be
 * one for a single screen, so the encoder lives here. Only what pairing needs is
 * implemented: byte mode (any UTF-8 text), error correction level M and
 * versions 1-10 (up to 213 bytes; a pairing payload is about 60). The structure
 * follows ISO/IEC 18004; `qr.test.ts` checks the output decodes back to the
 * input with an independent decoder.
 */

interface BlockSpec {
  readonly count: number;
  readonly dataCodewords: number;
}

interface VersionSpec {
  readonly version: number;
  readonly ecPerBlock: number;
  readonly blocks: readonly BlockSpec[];
}

/** Error correction M, as the two format bits the symbol carries. */
const ECC_FORMAT_BITS = 0b00;

/** Data/ECC block layout per version at level M, from the standard's tables. */
const VERSIONS: readonly VersionSpec[] = [
  { version: 1, ecPerBlock: 10, blocks: [{ count: 1, dataCodewords: 16 }] },
  { version: 2, ecPerBlock: 16, blocks: [{ count: 1, dataCodewords: 28 }] },
  { version: 3, ecPerBlock: 26, blocks: [{ count: 1, dataCodewords: 44 }] },
  { version: 4, ecPerBlock: 18, blocks: [{ count: 2, dataCodewords: 32 }] },
  { version: 5, ecPerBlock: 24, blocks: [{ count: 2, dataCodewords: 43 }] },
  { version: 6, ecPerBlock: 16, blocks: [{ count: 4, dataCodewords: 27 }] },
  { version: 7, ecPerBlock: 18, blocks: [{ count: 4, dataCodewords: 31 }] },
  {
    version: 8,
    ecPerBlock: 22,
    blocks: [
      { count: 2, dataCodewords: 38 },
      { count: 2, dataCodewords: 39 },
    ],
  },
  {
    version: 9,
    ecPerBlock: 22,
    blocks: [
      { count: 3, dataCodewords: 36 },
      { count: 2, dataCodewords: 37 },
    ],
  },
  {
    version: 10,
    ecPerBlock: 26,
    blocks: [
      { count: 4, dataCodewords: 43 },
      { count: 1, dataCodewords: 44 },
    ],
  },
];

/** Alignment pattern centres per version; a version with none has an empty list. */
const ALIGNMENT_POSITIONS: readonly (readonly number[])[] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

// ── Reed-Solomon over GF(256) ────────────────────────────────────────────────

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let value = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = value;
    GF_LOG[value] = i;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255] as number;
}

function gfMultiply(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[(GF_LOG[a] as number) + (GF_LOG[b] as number)] as number;
}

/** The generator polynomial for `degree` error-correction codewords. */
function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j] as number, root);
      if (j + 1 < result.length) result[j] = (result[j] as number) ^ (result[j + 1] as number);
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ (result[0] as number);
    result.shift();
    result.push(0);
    for (let i = 0; i < result.length; i++) {
      result[i] = (result[i] as number) ^ gfMultiply(divisor[i] as number, factor);
    }
  }
  return result;
}

// ── Bit-level encoding ───────────────────────────────────────────────────────

function totalDataCodewords(spec: VersionSpec): number {
  return spec.blocks.reduce((sum, block) => sum + block.count * block.dataCodewords, 0);
}

function chooseVersion(byteLength: number): VersionSpec {
  for (const spec of VERSIONS) {
    // Byte mode: 4 mode bits, 8 or 16 count bits (versions 10 and up), then data.
    const countBits = spec.version <= 9 ? 8 : 16;
    const needed = 4 + countBits + byteLength * 8;
    if (byteLength < 2 ** countBits && needed <= totalDataCodewords(spec) * 8) return spec;
  }
  throw new Error(`QR payload is too long: ${byteLength} bytes does not fit versions 1-10`);
}

function pushBits(target: number[], value: number, length: number): void {
  for (let i = length - 1; i >= 0; i--) target.push((value >>> i) & 1);
}

/** Mode, count, payload, terminator, padding — then error correction and interleaving. */
function encodeCodewords(text: string): { spec: VersionSpec; codewords: number[] } {
  const bytes = new TextEncoder().encode(text);
  const spec = chooseVersion(bytes.length);
  const capacityBits = totalDataCodewords(spec) * 8;

  const bits: number[] = [];
  pushBits(bits, 0b0100, 4);
  pushBits(bits, bytes.length, spec.version <= 9 ? 8 : 16);
  for (const byte of bytes) pushBits(bits, byte, 8);
  for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | (bits[i + j] as number);
    data.push(byte);
  }
  for (let pad = 0xec; data.length < totalDataCodewords(spec); pad ^= 0xec ^ 0x11) data.push(pad);

  const divisor = rsDivisor(spec.ecPerBlock);
  const blocks: { data: number[]; ec: number[] }[] = [];
  let offset = 0;
  for (const blockSpec of spec.blocks) {
    for (let i = 0; i < blockSpec.count; i++) {
      const block = data.slice(offset, offset + blockSpec.dataCodewords);
      offset += blockSpec.dataCodewords;
      blocks.push({ data: block, ec: rsRemainder(block, divisor) });
    }
  }

  const codewords: number[] = [];
  const longest = Math.max(...blocks.map((block) => block.data.length));
  for (let i = 0; i < longest; i++) {
    for (const block of blocks) {
      const byte = block.data[i];
      if (byte !== undefined) codewords.push(byte);
    }
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (const block of blocks) codewords.push(block.ec[i] as number);
  }
  return { spec, codewords };
}

// ── Symbol construction ──────────────────────────────────────────────────────

function formatBits(mask: number): number {
  const data = (ECC_FORMAT_BITS << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  return ((data << 10) | remainder) ^ 0x5412;
}

function versionBits(version: number): number {
  let remainder = version;
  for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
  return (version << 12) | remainder;
}

function maskApplies(mask: number, row: number, column: number): boolean {
  switch (mask) {
    case 0:
      return (row + column) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return column % 3 === 0;
    case 3:
      return (row + column) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0;
    case 5:
      return ((row * column) % 2) + ((row * column) % 3) === 0;
    case 6:
      return (((row * column) % 2) + ((row * column) % 3)) % 2 === 0;
    default:
      return (((row + column) % 2) + ((row * column) % 3)) % 2 === 0;
  }
}

class QrSymbol {
  readonly size: number;
  readonly dark: boolean[][];
  private readonly reserved: boolean[][];

  constructor(private readonly spec: VersionSpec) {
    this.size = spec.version * 4 + 17;
    this.dark = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.reserved = Array.from({ length: this.size }, () =>
      new Array<boolean>(this.size).fill(false),
    );
  }

  private setFunction(column: number, row: number, isDark: boolean): void {
    // Finder patterns are drawn as a 9x9 block centred on a corner, so the
    // outer ring falls outside the symbol and is simply clipped.
    if (row < 0 || column < 0 || row >= this.size || column >= this.size) return;
    const darkRow = this.dark[row];
    const reservedRow = this.reserved[row];
    if (!darkRow || !reservedRow) return;
    darkRow[column] = isDark;
    reservedRow[column] = true;
  }

  /** Whether the module at (column, row) is dark. */
  private moduleAt(column: number, row: number): boolean {
    return this.dark[row]?.[column] === true;
  }

  drawFunctionPatterns(): void {
    const size = this.size;
    for (let i = 0; i < size; i++) {
      this.setFunction(6, i, i % 2 === 0);
      this.setFunction(i, 6, i % 2 === 0);
    }

    for (const [column, row] of [
      [3, 3],
      [size - 4, 3],
      [3, size - 4],
    ] as const) {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const distance = Math.max(Math.abs(dx), Math.abs(dy));
          this.setFunction(column + dx, row + dy, distance !== 2 && distance !== 4);
        }
      }
    }

    const positions = ALIGNMENT_POSITIONS[this.spec.version - 1] as readonly number[];
    const last = positions.length - 1;
    for (let i = 0; i < positions.length; i++) {
      for (let j = 0; j < positions.length; j++) {
        // Only the three finder corners keep their own pattern. Every other
        // pair is drawn, including the ones that sit on the timing pattern —
        // those overlap it by design.
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
        const column = positions[i] as number;
        const row = positions[j] as number;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            this.setFunction(column + dx, row + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
          }
        }
      }
    }

    // Reserve the format area now so codeword placement skips it; the real bits
    // are drawn once the mask is known.
    this.drawFormat(0);
    this.drawVersion();

    // The module next to the bottom-left finder is always dark.
    this.setFunction(8, size - 8, true);
  }

  drawVersion(): void {
    if (this.spec.version < 7) return;
    const bits = versionBits(this.spec.version);
    for (let i = 0; i < 18; i++) {
      const isDark = ((bits >>> i) & 1) !== 0;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunction(a, b, isDark);
      this.setFunction(b, a, isDark);
    }
  }

  drawFormat(mask: number): void {
    const bits = formatBits(mask);
    const bit = (index: number): boolean => ((bits >>> index) & 1) !== 0;
    const size = this.size;

    for (let i = 0; i <= 5; i++) this.setFunction(8, i, bit(i));
    this.setFunction(8, 7, bit(6));
    this.setFunction(8, 8, bit(7));
    this.setFunction(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.setFunction(14 - i, 8, bit(i));

    for (let i = 0; i < 8; i++) this.setFunction(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.setFunction(8, size - 15 + i, bit(i));
  }

  drawCodewords(codewords: readonly number[]): void {
    const size = this.size;
    let index = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vertical = 0; vertical < size; vertical++) {
        for (let offset = 0; offset < 2; offset++) {
          const column = right - offset;
          const upward = ((right + 1) & 2) === 0;
          const row = upward ? size - 1 - vertical : vertical;
          if (!this.reserved[row]?.[column] && index < codewords.length * 8) {
            const byte = codewords[index >>> 3] ?? 0;
            const darkRow = this.dark[row];
            if (darkRow) darkRow[column] = ((byte >>> (7 - (index & 7))) & 1) !== 0;
            index++;
          }
        }
      }
    }
  }

  applyMask(mask: number): void {
    for (let row = 0; row < this.size; row++) {
      for (let column = 0; column < this.size; column++) {
        if (this.reserved[row]?.[column]) continue;
        const darkRow = this.dark[row];
        if (darkRow && maskApplies(mask, row, column)) darkRow[column] = darkRow[column] !== true;
      }
    }
  }

  /** The standard's four penalty rules; lower is easier to scan. */
  private penalty(): number {
    const size = this.size;
    let score = 0;

    for (let i = 0; i < size; i++) {
      for (const horizontal of [true, false]) {
        let run = 1;
        for (let j = 1; j < size; j++) {
          const previous = this.module(i, j - 1, horizontal);
          const current = this.module(i, j, horizontal);
          if (current === previous) {
            run++;
          } else {
            if (run >= 5) score += 3 + (run - 5);
            run = 1;
          }
        }
        if (run >= 5) score += 3 + (run - 5);
      }
    }

    for (let row = 0; row < size - 1; row++) {
      for (let column = 0; column < size - 1; column++) {
        const first = this.moduleAt(column, row);
        if (
          first === this.moduleAt(column + 1, row) &&
          first === this.moduleAt(column, row + 1) &&
          first === this.moduleAt(column + 1, row + 1)
        ) {
          score += 3;
        }
      }
    }

    // Finder-like 1:1:3:1:1 sequences, with four light modules on one side.
    const dark: readonly boolean[] = [
      true,
      false,
      true,
      true,
      true,
      false,
      true,
      false,
      false,
      false,
      false,
    ];
    const light: readonly boolean[] = [...dark].reverse();
    for (let i = 0; i < size; i++) {
      for (let j = 0; j <= size - 11; j++) {
        for (const pattern of [dark, light]) {
          let matches = true;
          for (let k = 0; k < 11 && matches; k++) {
            if (this.module(i, j + k, true) !== pattern[k]) matches = false;
            if (this.module(j + k, i, false) !== pattern[k]) matches = false;
          }
          if (matches) score += 40;
        }
      }
    }

    let darkCount = 0;
    for (const row of this.dark) for (const module of row) if (module) darkCount++;
    const percent = (darkCount * 100) / (size * size);
    score += Math.floor(Math.abs(percent - 50) / 5) * 10;

    return score;
  }

  /** `horizontal` reads a row; otherwise a column. */
  private module(fixed: number, index: number, horizontal: boolean): boolean {
    return horizontal ? this.moduleAt(index, fixed) : this.moduleAt(fixed, index);
  }

  chooseMask(): void {
    let best = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let mask = 0; mask < 8; mask++) {
      this.applyMask(mask);
      this.drawFormat(mask);
      const score = this.penalty();
      if (score < bestScore) {
        bestScore = score;
        best = mask;
      }
      this.applyMask(mask);
    }
    this.applyMask(best);
    this.drawFormat(best);
  }
}

/** The symbol as rows of modules; `true` is dark. Includes no quiet zone. */
export function qrMatrix(text: string): readonly (readonly boolean[])[] {
  const { spec, codewords } = encodeCodewords(text);
  const symbol = new QrSymbol(spec);
  symbol.drawFunctionPatterns();
  symbol.drawCodewords(codewords);
  symbol.chooseMask();
  return symbol.dark;
}

/**
 * The symbol as a standalone SVG image: dark modules on white, with the quiet
 * zone baked in. Fixed colours on purpose — a QR code must not follow the
 * editor's theme to stay scannable.
 */
export function qrSvg(
  text: string,
  options: { readonly scale?: number; readonly border?: number } = {},
): string {
  const matrix = qrMatrix(text);
  const border = options.border ?? 4;
  const scale = options.scale ?? 4;
  const size = matrix.length;
  const dimension = (size + border * 2) * scale;

  const runs: string[] = [];
  matrix.forEach((row, y) => {
    let x = 0;
    while (x < size) {
      if (!row[x]) {
        x++;
        continue;
      }
      let end = x;
      while (end < size && row[end]) end++;
      const width = (end - x) * scale;
      const left = (x + border) * scale;
      const top = (y + border) * scale;
      runs.push(`M${left} ${top}h${width}v${scale}h-${width}Z`);
      x = end;
    }
  });

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${dimension}" height="${dimension}" viewBox="0 0 ${dimension} ${dimension}" shape-rendering="crispEdges" role="img" aria-label="Pairing QR code">`,
    `<rect width="${dimension}" height="${dimension}" fill="#ffffff"/>`,
    `<path fill="#000000" d="${runs.join("")}"/>`,
    `</svg>`,
  ].join("");
}
