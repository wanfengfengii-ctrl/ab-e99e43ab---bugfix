// HTTP 冒烟：启动真实服务 -> 健康检查 -> 静态首页 ->
// POST 可行方案 -> POST 不可行方案（证据）-> POST 非法输入（422）。
// 任一步断言失败即以非零码退出，供 docker compose 的 verify 服务报告验收结果。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = process.env.SMOKE_PORT || '8099';
const BASE = `http://127.0.0.1:${PORT}`;

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    console.error(`  ✗ ${name} ${extra}`);
    failures++;
  }
}

const feasiblePayload = {
  rails: [
    [{ x: -3, y: 0 }, { x: -8, y: 0 }],
    [{ x: 3, y: 0 }, { x: 8, y: 0 }],
    [{ x: 0, y: -3 }, { x: 0, y: -8 }],
    [{ x: 0, y: 3 }, { x: 0, y: 8 }],
  ],
  boundary: [
    { x: -12, y: -12 }, { x: 12, y: -12 }, { x: 12, y: 12 }, { x: -12, y: 12 },
  ],
  cg: { x: 0, y: 0 },
  toleranceX: 2,
  toleranceY: 2,
  minSpacing: 1,
};

const infeasiblePayload = {
  ...feasiblePayload,
  minSpacing: 100, // 任何组合都无法满足
};

async function waitReady(proc, deadlineMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    if (proc.exitCode !== null) throw new Error(`服务进程提前退出，code=${proc.exitCode}`);
    try {
      const r = await fetch(`${BASE}/healthz`);
      if (r.ok) return;
    } catch { /* 尚未监听，重试 */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('等待服务健康检查超时');
}

async function main() {
  const proc = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT, HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
  proc.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

  try {
    console.log('1) 启动服务并等待健康检查');
    await waitReady(proc);

    console.log('2) GET /healthz');
    const h = await fetch(`${BASE}/healthz`);
    check('健康检查 200', h.status === 200, `status=${h.status}`);
    check('健康检查 JSON status=ok', (await h.json()).status === 'ok');

    console.log('3) GET / 静态首页');
    const home = await fetch(`${BASE}/`);
    const html = await home.text();
    check('首页 200', home.status === 200, `status=${home.status}`);
    check('首页包含标题', html.includes('支撑垫选点裁决'));
    check('首页引用 app.js', html.includes('/app.js'));

    console.log('4) POST /api/fixture-plans 可行场景');
    const okResp = await fetch(`${BASE}/api/fixture-plans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(feasiblePayload),
    });
    check('返回 200', okResp.status === 200, `status=${okResp.status}`);
    const ok = await okResp.json();
    check('feasible=true', ok.feasible === true);
    check('枚举了全部 16 个组合', ok.evaluatedCombinations === 16, `got=${ok.evaluatedCombinations}`);
    check('每轨恰选一点(4 个)', Array.isArray(ok.selection) && ok.selection.length === 4);
    check('四角裕量均严格为正', ok.corners?.length === 4 && ok.corners.every((c) => c.margin > 1e-9));
    check('选用外侧组合编号 [2,2,2,2]', JSON.stringify(ok.metrics.indices) === '[1,1,1,1]',
      `got=${JSON.stringify(ok.metrics.indices)}`);
    check('凸包至少 3 个顶点', ok.hull.length >= 3);

    console.log('5) POST /api/fixture-plans 不可行场景（间距 100）');
    const badResp = await fetch(`${BASE}/api/fixture-plans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(infeasiblePayload),
    });
    check('仍返回 200（业务裁决结果）', badResp.status === 200, `status=${badResp.status}`);
    const bad = await badResp.json();
    check('feasible=false', bad.feasible === false);
    check('失败原因为 spacing_failed', bad.reason === 'spacing_failed', `reason=${bad.reason}`);
    check('附带最接近失败约束的证据', !!bad.evidence && bad.evidence.candidateNumbers.length === 4);
    check('证据含可读 message', typeof bad.message === 'string' && bad.message.length > 0);

    console.log('6) POST 非法输入返回 422');
    const invResp = await fetch(`${BASE}/api/fixture-plans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rails: [], boundary: [], cg: { x: 0, y: 0 } }),
    });
    check('校验失败 422', invResp.status === 422, `status=${invResp.status}`);
    const inv = await invResp.json();
    check('422 含错误说明', typeof inv.detail === 'string' && inv.detail.length > 0);

    console.log('7) POST 非法 JSON 返回 400');
    const junkResp = await fetch(`${BASE}/api/fixture-plans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json',
    });
    check('非法 JSON 400', junkResp.status === 400, `status=${junkResp.status}`);

    console.log('8) POST /api/fixture-plans 超大但有限的坐标场景');
    // 坐标 ~1e307：外方形候选（1e307）的最小裕量严格大于内方形（9e306），
    // 必须唯一选出候选编号 [2,2,2,2]，且全部裕量为有限数值（不得为 null）。
    const hugeResp = await fetch(`${BASE}/api/fixture-plans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        rails: [
          [{ x: -9e306, y: -9e306 }, { x: -1e307, y: -1e307 }],
          [{ x: 9e306, y: -9e306 }, { x: 1e307, y: -1e307 }],
          [{ x: 9e306, y: 9e306 }, { x: 1e307, y: 1e307 }],
          [{ x: -9e306, y: 9e306 }, { x: -1e307, y: 1e307 }],
        ],
        boundary: [
          { x: -1.1e307, y: -1.1e307 }, { x: 1.1e307, y: -1.1e307 },
          { x: 1.1e307, y: 1.1e307 }, { x: -1.1e307, y: 1.1e307 },
        ],
        cg: { x: 0, y: 0 },
        toleranceX: 0,
        toleranceY: 0,
        minSpacing: 1,
      }),
    });
    check('返回 200', hugeResp.status === 200, `status=${hugeResp.status}`);
    const huge = await hugeResp.json();
    check('feasible=true', huge.feasible === true);
    check(
      '唯一选择外方形候选编号 [2,2,2,2]',
      JSON.stringify(huge.selection?.map((s) => s.candidateNumber)) === '[2,2,2,2]',
      `got=${JSON.stringify(huge.selection?.map((s) => s.candidateNumber))}`
    );
    const nearOuter = (v) => Number.isFinite(v) && Math.abs(v - 1e307) <= 1e307 * 1e-6;
    check(
      '四个角点裕量均为有限数值且约为 1e307',
      huge.corners?.length === 4 && huge.corners.every((c) => nearOuter(c.margin)),
      `got=${JSON.stringify(huge.corners?.map((c) => c.margin))}`
    );
    check(
      'metrics.minMargin 为有限数值且约为 1e307',
      nearOuter(huge.metrics?.minMargin),
      `got=${huge.metrics?.minMargin}`
    );
    check('外方形裕量严格大于内方形约 9e306', huge.metrics?.minMargin > 9e306);

    console.log('9) POST /api/fixture-plans 大幅平移坐标场景（1e307 平移 + 1e292 局部跨度）');
    // 回归：该唯一有效支撑组合曾被误判为 hull_degenerate（minCornerMargin 为 null）。
    // 四点形成边长约 3.99e292 的方形，标称重心严格位于其中，两偏差均为 0。
    const shiftedResp = await fetch(`${BASE}/api/fixture-plans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        rails: [
          [{ x: 1e307 - 2e292, y: 1e307 - 2e292 }],
          [{ x: 1e307 + 2e292, y: 1e307 - 2e292 }],
          [{ x: 1e307 + 2e292, y: 1e307 + 2e292 }],
          [{ x: 1e307 - 2e292, y: 1e307 + 2e292 }],
        ],
        boundary: [
          { x: 1e307 - 4e292, y: 1e307 - 4e292 }, { x: 1e307 + 4e292, y: 1e307 - 4e292 },
          { x: 1e307 + 4e292, y: 1e307 + 4e292 }, { x: 1e307 - 4e292, y: 1e307 + 4e292 },
        ],
        cg: { x: 1e307, y: 1e307 },
        toleranceX: 0,
        toleranceY: 0,
        minSpacing: 1,
      }),
    });
    check('返回 200', shiftedResp.status === 200, `status=${shiftedResp.status}`);
    const shifted = await shiftedResp.json();
    check('feasible=true', shifted.feasible === true, `reason=${shifted.reason}`);
    check(
      '四条导轨各自唯一的候选 [1,1,1,1]',
      JSON.stringify(shifted.selection?.map((s) => s.candidateNumber)) === '[1,1,1,1]',
      `got=${JSON.stringify(shifted.selection?.map((s) => s.candidateNumber))}`
    );
    // 半边长约为 2e292（坐标按 ulp 舍入，容差取 1%）
    const nearHalfSide = (v) => Number.isFinite(v) && v > 0 && Math.abs(v - 2e292) <= 2e292 * 1e-2;
    check(
      '四个角点裕量均为有限正数且约为 2e292',
      shifted.corners?.length === 4 && shifted.corners.every((c) => nearHalfSide(c.margin)),
      `got=${JSON.stringify(shifted.corners?.map((c) => c.margin))}`
    );
    check(
      'metrics.minMargin 为有限正数且约为 2e292',
      nearHalfSide(shifted.metrics?.minMargin),
      `got=${shifted.metrics?.minMargin}`
    );
  } catch (err) {
    console.error(`冒烟执行异常：${err.stack || err.message}`);
    failures++;
  } finally {
    proc.kill('SIGTERM');
  }

  if (failures > 0) {
    console.error(`\n冒烟结果：${failures} 项断言失败`);
    process.exit(1);
  }
  console.log('\n冒烟结果：全部通过');
  process.exit(0);
}

main();
