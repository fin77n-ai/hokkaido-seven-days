# AGENTS.md — 北海道七日冬旅攻略 (hokkaido-seven-days)

本项目是面向移动端的零依赖单文件离线 PWA 旅行手册（`2026.12.25–12.31` 北海道情侣慢游局：洞爷湖万世阁 × 札幌 Stream × 小樽看海 × 手稻滑雪 × 私汤拍照 × NANGA 扫货）。

## 目录与核心文件

- `index.html`：单文件应用主体（CSS + HTML + 原生 JS）。
- `manifest.webmanifest` / `sw.js`：PWA 离线缓存配置。
- `icon.svg` / `apple-touch-icon.png` / `icon-192.png` / `icon-512.png`：应用图标。
- `CLAUDE.md`：详细的行程约束、节假日排雷红线与移动端验收标准（修改前必读）。

## Agent 协作守则

1. 修改行程节点时严格按 `<article class="day-card" id="d1">...#d7` 边界定位。
2. 任何新增景点或餐厅必须核验 **12/25–12/31 年末年始营业时间**，严禁把 12/31 休馆点排入 D7。
3. 每次修改 `index.html` 后，必须提取 `<script>` 运行 `node --check` 验证语法，并同步递增 `sw.js` 中的 `CACHE_NAME` 版本号。
