
// Ported from Stefan Gustavson's Java implementation:
// http://staffwww.itn.liu.se/~stegu/simplexnoise/simplexnoise.pdf
// and adapted to TypeScript. This is a common public domain implementation.

class Grad {
  constructor(public x: number, public y: number, public z: number) {}
}

export class SimplexNoise {
  private static grad3: Grad[] = [
    new Grad(1, 1, 0), new Grad(-1, 1, 0), new Grad(1, -1, 0), new Grad(-1, -1, 0),
    new Grad(1, 0, 1), new Grad(-1, 0, 1), new Grad(1, 0, -1), new Grad(-1, 0, -1),
    new Grad(0, 1, 1), new Grad(0, -1, 1), new Grad(0, 1, -1), new Grad(0, -1, -1),
  ];

  private p: number[] = [];
  private perm: number[] = [];
  private permMod12: number[] = [];

  constructor(seed?: number) {
    const random = seed !== undefined ? this.seededRandom(seed) : Math.random;
    for (let i = 0; i < 256; i++) {
      this.p[i] = Math.floor(random() * 256);
    }
    for (let i = 0; i < 512; i++) {
      this.perm[i] = this.p[i & 255];
      this.permMod12[i] = this.perm[i] % 12;
    }
  }

  private seededRandom(seed: number): () => number {
    let m = 0x80000000; // 2**31
    let a = 1103515245;
    let c = 12345;
    let state = seed ? seed : Math.floor(Math.random() * (m-1));
    return function() {
      state = (a * state + c) % m;
      return state / (m - 1);
    }
  }


  private static F2: number = 0.5 * (Math.sqrt(3.0) - 1.0);
  private static G2: number = (3.0 - Math.sqrt(3.0)) / 6.0;

  private dot(g: Grad, x: number, y: number): number {
    return g.x * x + g.y * y;
  }

  public noise2D(xin: number, yin: number): number {
    let n0: number, n1: number, n2: number; // Noise contributions from the three corners

    // Skew the input space to determine which simplex cell we're in
    const s: number = (xin + yin) * SimplexNoise.F2; // Hairy factor for 2D
    const i: number = Math.floor(xin + s);
    const j: number = Math.floor(yin + s);
    const t: number = (i + j) * SimplexNoise.G2;
    const X0: number = i - t; // Unskew the cell origin back to (x,y) space
    const Y0: number = j - t;
    const x0: number = xin - X0; // The x,y distances from the cell origin
    const y0: number = yin - Y0;

    // For the 2D case, the simplex shape is an equilateral triangle.
    // Determine which simplex we are in.
    let i1: number, j1: number; // Offsets for second corner of simplex in (i,j) coords
    if (x0 > y0) {
      i1 = 1;
      j1 = 0;
    } // lower triangle, XY order: (0,0)->(1,0)->(1,1)
    else {
      i1 = 0;
      j1 = 1;
    } // upper triangle, YX order: (0,0)->(0,1)->(1,1)

    // A step of (1,0) in (i,j) means a step of (1-c,-c) in (x,y), and
    // a step of (0,1) in (i,j) means a step of (-c,1-c) in (x,y), where
    // c = (3-sqrt(3))/6
    const x1: number = x0 - i1 + SimplexNoise.G2; // Offsets for middle corner in (x,y) unskewed coords
    const y1: number = y0 - j1 + SimplexNoise.G2;
    const x2: number = x0 - 1.0 + 2.0 * SimplexNoise.G2; // Offsets for last corner in (x,y) unskewed coords
    const y2: number = y0 - 1.0 + 2.0 * SimplexNoise.G2;

    // Work out the hashed gradient indices of the three simplex corners
    const ii: number = i & 255;
    const jj: number = j & 255;
    const gi0: number = this.permMod12[ii + this.perm[jj]];
    const gi1: number = this.permMod12[ii + i1 + this.perm[jj + j1]];
    const gi2: number = this.permMod12[ii + 1 + this.perm[jj + 1]];

    // Calculate the contribution from the three corners
    let t0: number = 0.5 - x0 * x0 - y0 * y0;
    if (t0 < 0) n0 = 0.0;
    else {
      t0 *= t0;
      n0 = t0 * t0 * this.dot(SimplexNoise.grad3[gi0], x0, y0); // (x,y) of grad3 used for 2D gradient
    }

    let t1: number = 0.5 - x1 * x1 - y1 * y1;
    if (t1 < 0) n1 = 0.0;
    else {
      t1 *= t1;
      n1 = t1 * t1 * this.dot(SimplexNoise.grad3[gi1], x1, y1);
    }

    let t2: number = 0.5 - x2 * x2 - y2 * y2;
    if (t2 < 0) n2 = 0.0;
    else {
      t2 *= t2;
      n2 = t2 * t2 * this.dot(SimplexNoise.grad3[gi2], x2, y2);
    }

    // Add contributions from each corner to get the final noise value.
    // The result is scaled to return values in the interval [-1,1].
    return 70.0 * (n0 + n1 + n2);
  }
}
