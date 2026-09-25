# 卫星太阳翼支撑垫选点裁决

卫星太阳翼展开试验前，从四条安装导轨各自批准的支撑垫候选点中各选一处，使得**重心存在测量偏差时翼板仍不会越过支撑多边形倾覆**。本项目为零第三方依赖的前后端一体应用。

## 裁决规则

对四条导轨候选点做**完整组合穷举**（在服务端直接裁决，前端不参与决策）：

1. **硬约束**
   - 每条导轨恰好选择一个候选点；
   - 选点必须位于翼板批准边界多边形内（含边界）；
   - 任意两个支撑垫间距 ≥ 最小间距；
   - 重心偏差矩形（标称重心 ± 横/纵偏差）的**四个角点全部严格位于**四点支撑凸包内部（落在边上不算，有符号距离必须 > 0）。
2. **优化目标（字典序）**
   - 先最大化四角到凸包边界的**最小有符号距离**（最差角点的稳定裕量）；
   - 再最小化四个支撑垫到标称重心的**距离和**；
   - 仍并列时按导轨输入顺序的**候选编号序列取字典序最小**，保证唯一稳定方案。
3. **无可行方案**：返回在检查流程中走得最远、违约缺口最小的组合证据（失败环节 `boundary_failed / spacing_failed / hull_degenerate / corners_failed`、编号序列、凸包、各角点裕量），前端撤下旧结果并展示该证据。

枚举按导轨顺序、候选编号升序进行，首个最优解即稳定唯一解。

## 接口

`POST /api/fixture-plans`

```json
{
  "rails": [
    [{"x": -3, "y": 0}, {"x": -8, "y": 0}],
    [{"x": 3, "y": 0}, {"x": 8, "y": 0}],
    [{"x": 0, "y": -3}, {"x": 0, "y": -8}],
    [{"x": 0, "y": 3}, {"x": 0, "y": 8}]
  ],
  "boundary": [{"x": -12, "y": -12}, {"x": 12, "y": -12}, {"x": 12, "y": 12}, {"x": -12, "y": 12}],
  "cg": {"x": 0, "y": 0},
  "toleranceX": 2,
  "toleranceY": 2,
  "minSpacing": 1
}
```

成功返回 `feasible: true` 及 `selection`（四点）、`hull`、`corners`（四角及有符号距离）、`metrics`；无方案返回 `feasible: false` 与 `evidence`；输入非法返回 `422`。另有 `GET /healthz` 健康检查。

## 本地运行（无需安装依赖，Node ≥ 20）

```bash
npm start        # http://localhost:8080
npm test         # node:test 单元测试
npm run smoke    # 启动服务并做 HTTP 冒烟，退出码反映结果
```

## Docker

宿主机端口通过 `APP_PORT` 配置（默认 8080），容器内置 HEALTHCHECK：

```bash
APP_PORT=9090 docker compose up --build -d web
# 浏览器打开 http://localhost:9090
```

一次性验收服务 `verify`：依次完成镜像构建、单元测试、HTTP 冒烟，随后自行退出，**退出码即验收结论**（0 通过）：

```bash
docker compose up --build --abort-on-container-exit --exit-code-from verify verify
# 或先起 web 再跑验收：
docker compose up -d web
docker compose run --rm verify
```

## 目录结构

```
server/geometry.js   凸包/有符号距离/点-多边形等纯几何
server/solver.js     输入校验、完整组合穷举与两级裁决、失败证据
server/server.js     零依赖 HTTP 服务（静态托管 + API + healthz）
public/              前端页面：参数录入、SVG 选点/凸包/偏差矩形四角裕量
test/                node:test 单元测试
smoke/smoke.mjs      HTTP 冒烟（健康检查/静态页/可行/不可行/非法输入）
```
