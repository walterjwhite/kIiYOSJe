import { describe, expect, it } from "vitest";
import { qrMatrix, qrSvg } from "../src/qr.js";

const PAIRING = "mind://pair?server=http%3A%2F%2F127.0.0.1%3A8787&code=123456";

function render(matrix: readonly (readonly boolean[])[]): string[] {
  return matrix.map((row) => row.map((dark) => (dark ? "#" : ".")).join(""));
}

describe("pairing QR code", () => {
  // Recorded after an independent decoder read this symbol back as PAIRING, so
  // the golden pins the whole pipeline at once: mode and count bits, padding,
  // Reed-Solomon blocks, interleaving, mask selection and the format bits. A
  // change that still decodes but masks differently will fail here — that is
  // intended, since the point is to notice any change at all.
  const EXPECTED = [
    "#######..#####.....##..#..#######",
    "#.....#..#...###.....#....#.....#",
    "#.###.#.##.#.#..#...##.##.#.###.#",
    "#.###.#.#####.##.##.......#.###.#",
    "#.###.#.##..#..#...######.#.###.#",
    "#.....#.##.#..##.....##...#.....#",
    "#######.#.#.#.#.#.#.#.#.#.#######",
    "........##....#.#.#.###.#........",
    "#.#####...#..#.#.#..#.#...#####..",
    "#...#.....#...####.#####.##....##",
    "##....#..#..#..#......#.....###..",
    "...#.#..#..#..#......###....####.",
    "####.##.###....#####...##...#....",
    "#....#..###..##....####...##..#.#",
    "#...####..#.#.###.#.#......##..#.",
    ".##....#...#.####.####.##...#.##.",
    ".###..####.#...#####..#..#.###.##",
    ".#.##..#..#.#.#...###.###.##.#.##",
    "#.#.#.##.#.##..##.#.##..###.#....",
    "..#..#.###.....##...##.##.#.###.#",
    "##.####.#.#.########.......##..#.",
    "##..#...###.#......#########.##.#",
    "#.#.#.#.#.##.###....#.#....#.#.#.",
    "#...##.###...####..#.#...#.#..#..",
    "#...#.#.##..####.##.#.#.#####..##",
    "........#.#..#.....#.#.##...###..",
    "#######..##.#######...###.#.#.##.",
    "#.....#.##..####..##.####...#.#.#",
    "#.###.#.#..###.####.....######...",
    "#.###.#.##..#......###.###.###.##",
    "#.###.#.##.##.#####..##...##.....",
    "#.....#....####....####....##.#..",
    "#######.##.....#....#.#.##.###.#.",
  ];

  it("encodes a pairing payload to the expected symbol", () => {
    expect(render(qrMatrix(PAIRING))).toEqual(EXPECTED);
  });

  it("grows the symbol with the payload", () => {
    expect(qrMatrix("a")).toHaveLength(21);
    expect(qrMatrix(PAIRING)).toHaveLength(33);
    expect(qrMatrix("a".repeat(180))).toHaveLength(53);
  });

  it("draws the three finder patterns", () => {
    const matrix = qrMatrix(PAIRING);
    const size = matrix.length;
    for (const [row, column] of [
      [0, 0],
      [0, size - 7],
      [size - 7, 0],
    ] as const) {
      for (let y = 0; y < 7; y++) {
        for (let x = 0; x < 7; x++) {
          const edge = y === 0 || y === 6 || x === 0 || x === 6;
          const core = y >= 2 && y <= 4 && x >= 2 && x <= 4;
          expect(matrix[row + y]?.[column + x]).toBe(edge || core);
        }
      }
    }
  });

  it("renders a standalone svg with a light background and a quiet zone", () => {
    const svg = qrSvg(PAIRING);
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('shape-rendering="crispEdges"');
    // 33 modules plus a quiet zone of 4 on each side, at the default scale of 4.
    expect(svg).toContain('width="164"');
    expect(svg).toContain('viewBox="0 0 164 164"');
  });

  it("scales and borders on request", () => {
    expect(qrSvg("a", { scale: 2, border: 0 })).toContain('width="42"');
  });

  it("refuses a payload that does not fit the supported versions", () => {
    expect(() => qrMatrix("a".repeat(214))).toThrow(/too long/);
  });
});
