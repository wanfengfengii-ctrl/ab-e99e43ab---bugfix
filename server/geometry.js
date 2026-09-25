// 纯计算几何工具：二维点、有符号距离、凸包、点与简单多边形关系。
// 所有多边形约定按逆时针(CCW)给出边时，内部位于每条有向边的左侧，
// 因此“点到边的有符号距离”为正表示在内部、为负表示在外部、为 0 表示恰在边界上。
//
// 坐标可以是超大但有限的数值（如 1e307）：坐标之差仍在 double 范围内，
// 但两个坐标差的乘积会溢出为 Infinity（进而产生 NaN）。凡涉及坐标差乘积的
// 计算（叉积、面积、投影），这里都先平移到局部参考系、必要时再归一化/缩放，
// 保证超大坐标与大幅平移下仍得到有限、符号正确的结果。

export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

/**
 * 两个差向量的叉积 ux*vy - uy*vx 的溢出安全版本。
 * 常规范围直接计算并原样返回；乘积溢出（坐标差 ~1e307 量级）时按最大分量
 * 缩放后重算，返回值的符号与真实叉积一致，供只需判断转向/是否为零的调用方使用。
 */
function crossDiffs(ux, uy, vx, vy) {
  const c = ux * vy - uy * vx;
  if (Number.isFinite(c)) return c;
  const m = Math.max(Math.abs(ux), Math.abs(uy), Math.abs(vx), Math.abs(vy));
  if (!(m > 0) || !Number.isFinite(m)) return c;
  return (ux / m) * (vy / m) - (uy / m) * (vx / m);
}

export function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * 点 p 到过 a、b 的直线的有符号距离（沿 a->b 方向，左侧为正）。
 */
export function lineSide(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return pointDistance(p, a);
  // 用单位方向向量参与叉乘：|d|·|p-a| 的乘积在超大坐标下会溢出 double，
  // 先归一化方向可保证结果始终有限（数学上与 cross(d, p-a)/len 相同）。
  const ux = dx / len;
  const uy = dy / len;
  return ux * (p.y - a.y) - uy * (p.x - a.x);
}

/**
 * 点到线段的（无符号）距离，用于退化凸包（共线/重合）时的证据量化。
 */
export function distanceToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return pointDistance(p, a);
  // 投影参数 t = ((p-a)·d)/|d|² 改写为 ((p-a)·û)/|d|，避免 |d|² 在超大坐标下溢出
  let t = ((p.x - a.x) * (dx / len) + (p.y - a.y) * (dy / len)) / len;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function polygonSignedArea(poly) {
  if (poly.length === 0) return 0;
  // 鞋带和对整体平移不变：先减去参考点（首顶点）再累加，参与运算的是
  // 坐标差（与局部跨度同量级，且相近坐标相减是精确的）。若直接用绝对坐标，
  // 大平移基准（如整体平移 1e307、局部跨度 1e292）下面积信号会被
  // 坐标乘积的舍入误差淹没，得到 0 或错误符号，进而把有效凸包误判为退化。
  const rx = poly[0].x;
  const ry = poly[0].y;
  let span = 0;
  for (const p of poly) {
    span = Math.max(span, Math.abs(p.x - rx), Math.abs(p.y - ry));
  }
  if (Number.isFinite(span)) {
    let s = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      s += (a.x - rx) * (b.y - ry) - (b.x - rx) * (a.y - ry);
    }
    if (Number.isFinite(s)) return s / 2;
    // 局部跨度的乘积仍溢出（跨度本身 ~1e292 量级）：按跨度缩放后重新累加。
    // 此时真实面积一般已超出 double 范围，返回值保持正确符号（通常为
    // ±Infinity），调用方（ensureCCW、退化判断）只依赖符号或量级。
    if (span > 0) {
      let scaled = 0;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        scaled += ((a.x - rx) / span) * ((b.y - ry) / span) - ((b.x - rx) / span) * ((a.y - ry) / span);
      }
      return (scaled / 2) * span * span;
    }
    return s / 2; // 所有顶点重合：面积为 0
  }
  // 坐标差本身溢出（坐标分布在 ±1e308 两端）：退化为按绝对坐标缩放，
  // 至少保证符号正确。
  let m = 0;
  for (const p of poly) m = Math.max(m, Math.abs(p.x), Math.abs(p.y));
  if (!(m > 0) || !Number.isFinite(m)) return 0;
  let scaled = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    scaled += (a.x / m) * (b.y / m) - (b.x / m) * (a.y / m);
  }
  return (scaled / 2) * m * m;
}

/**
 * 保证多边形为逆时针方向。
 */
export function ensureCCW(poly) {
  return polygonSignedArea(poly) < 0 ? poly.slice().reverse() : poly.slice();
}

/**
 * 点到（逆时针）多边形边界的有符号距离：
 * 内部为正（到最近边的距离），外部为负。
 */
export function polygonSignedDistance(polyCCW, p) {
  let minAbs = Infinity;
  for (let i = 0; i < polyCCW.length; i++) {
    minAbs = Math.min(minAbs, lineSide(p, polyCCW[i], polyCCW[(i + 1) % polyCCW.length]));
  }
  return minAbs;
}

/**
 * 射线法点是否在多边形内（含边界）。
 */
export function pointInPolygon(poly, p) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const onBoundary =
      crossDiffs(a.x - p.x, a.y - p.y, b.x - p.x, b.y - p.y) === 0 &&
      Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) &&
      Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y);
    if (onBoundary) return true;
    // 先算纵向比例再乘回横差，避免 (b.x-a.x)*(p.y-a.y) 在超大坐标下溢出
    const intersects =
      a.y > p.y !== b.y > p.y &&
      p.x < a.x + (b.x - a.x) * ((p.y - a.y) / (b.y - a.y));
    if (intersects) inside = !inside;
  }
  return inside;
}

function dedupe(points) {
  const seen = new Set();
  const out = [];
  for (const p of points) {
    const key = `${p.x},${p.y}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

/**
 * Andrew 单调链凸包，返回逆时针顶点序列，剔除共线中间点。
 * 点数不足时原样返回（去重后）。
 */
export function convexHull(points) {
  const pts = dedupe(points).sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length <= 2) return pts;
  // 转向判断用溢出安全的叉积，超大坐标下不会退化为 Infinity/NaN
  const cross3 = (o, a, b) =>
    crossDiffs(a.x - o.x, a.y - o.y, b.x - o.x, b.y - o.y);

  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross3(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross3(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * 点到逆时针凸包边界的最小有符号距离（各边有符号距离的最小值）。
 * 凸包退化（不足 3 个顶点）时返回 -Infinity。
 */
export function convexMargin(hullCCW, p) {
  if (hullCCW.length < 3) return -Infinity;
  let m = Infinity;
  for (let i = 0; i < hullCCW.length; i++) {
    m = Math.min(m, lineSide(p, hullCCW[i], hullCCW[(i + 1) % hullCCW.length]));
  }
  return m;
}
