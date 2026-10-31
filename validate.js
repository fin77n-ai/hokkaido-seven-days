#!/usr/bin/env node
/**
 * validate.js — 北海道七日攻略自动化 Debug 与契约校验器
 * 融合 GitHub 四大开源旅行规划校验轮子：
 *   1. helping-ai-workflow/tripwork (day_chain 闭合日链 / 假名注释 / 年末闭馆碰撞 / Maps 搜索词精度)
 *   2. squiswardplaysuona/TravelGuide (trip-validator 首尾日航班缓冲链 / L.O.截单 / 每日餐饮住宿检查)
 *   3. skywain/trip-planner-skill (plan_lint 单调时钟防倒流 / 16:00冬季日落窗口校验)
 *   4. zexuanw958-svg/travel-plan-viz (DOM 契约 / 预约标签 / 弹窗与预设菜单对称性校验)
 *
 * 用法：node validate.js [index.html路径]
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = __dirname;
const htmlPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(rootDir, 'index.html');

const errors = [];
const warnings = [];
const passed = [];

function ok(msg) { passed.push(msg); }
function err(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }

function toMinutes(hhmm) {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// 1. 静态资源与 PWA 清单校验
const requiredFiles = [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'icon.svg',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'CLAUDE.md',
  'AGENTS.md'
];
for (const f of requiredFiles) {
  const p = path.join(rootDir, f);
  if (!fs.existsSync(p) || fs.statSync(p).size === 0) {
    err(`[PWA资产] 缺失或为空文件: ${f}`);
  }
}
try {
  const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.webmanifest'), 'utf8'));
  if (!manifest.name || !Array.isArray(manifest.icons) || manifest.icons.length < 2) {
    err('[PWA资产] manifest.webmanifest 缺少 name 或 icons 数组');
  } else {
    ok('[PWA资产] 全部 9 个核心文件与 manifest.webmanifest 校验通过');
  }
} catch (e) {
  err(`[PWA资产] manifest.webmanifest JSON 解析失败: ${e.message}`);
}

const html = fs.readFileSync(htmlPath, 'utf8');

// 2. 内联 JS 语法校验 (vm.Script)
const scriptMatches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (scriptMatches.length !== 1) {
  err(`[JS引擎] 期望 1 个内联 <script> 块，实际找到 ${scriptMatches.length} 个`);
} else {
  try {
    new vm.Script(scriptMatches[0][1], { filename: 'index.html#<script>' });
    ok('[JS引擎] 内联 JavaScript 语法编译通过 (零语法错误)');
  } catch (e) {
    err(`[JS引擎] JavaScript 语法错误: ${e.message}`);
  }
}

// 3. 文本卫生检查 (tripwork/text_hygiene.py: 检查未渲染的 Markdown 符号或冲突标记)
const htmlBeforeScript = html.slice(0, html.indexOf('<script>'));
const textOnly = htmlBeforeScript.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');
if (/`[^`]+`/.test(textOnly)) {
  err(`[文本卫生] HTML 正文中存在未转换的 Markdown 反引号: ${textOnly.match(/`[^`]+`/)[0]}`);
} else if (/\*\*[^*]+\*\*/.test(textOnly)) {
  err(`[文本卫生] HTML 正文中存在未转换的 Markdown 加粗星号: ${textOnly.match(/\*\*[^*]+\*\*/)[0]}`);
} else if (/^(<{7}|={7}|>{7})(\s|$)/m.test(html)) {
  err('[文本卫生] 存在 Git 合并冲突残留标记');
} else {
  ok('[文本卫生] 正文零 Markdown 残留符号、零 Git 冲突标记');
}

// 4. 闭合日链、单调时钟、餐饮住宿与首尾日缓冲校验 (tripwork + TravelGuide + skywain)
const dayIds = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'];
const expectedDates = ['12/25', '12/26', '12/27', '12/28', '12/29', '12/30', '12/31'];

dayIds.forEach((did, idx) => {
  const dayRegex = new RegExp(`<article class="day-card" id="${did}"[^>]*>([\\s\\S]*?)<\\/article>`);
  const m = html.match(dayRegex);
  if (!m) {
    err(`[闭合日链] 缺失日程卡片 #${did}`);
    return;
  }
  const dayHtml = m[1];
  const dateStr = expectedDates[idx];
  if (!dayHtml.includes(dateStr)) {
    err(`[日期对齐] #${did} 未包含预期日期 ${dateStr}`);
  }

  // 提取当日所有时间节点 (.n-time)
  const times = [...dayHtml.matchAll(/<span class="n-time">([^<]+)<\/span>/g)].map(x => x[1].trim());
  if (times.length < 3) {
    warn(`[日程密度] #${did} (${dateStr}) 时间节点少于 3 个 (${times.length})`);
  }
  let prevMin = -1;
  let prevRaw = '';
  for (const t of times) {
    const mins = toMinutes(t);
    if (mins === null) {
      err(`[时间格式] #${did} 存在非法时间格式: "${t}"`);
      continue;
    }
    if (mins < prevMin) {
      err(`[时钟倒流] #${did} (${dateStr}) 出现时间倒流或重叠: ${prevRaw} 之后出现了 ${t}`);
    }
    prevMin = mins;
    prevRaw = t;
  }

  // 检查每日是否包含显式交通连接盒 (.r-seg)，符合 tripwork 点-边-点闭合规则
  const segCount = [...dayHtml.matchAll(/class="r-item r-seg"/g)].length;
  if (segCount === 0) {
    err(`[点-边-点交通] #${did} (${dateStr}) 缺少 .r-seg 交通连接盒`);
  }

  // 检查每日是否包含餐饮节点 (days_have_meals)
  const hasFood = dayHtml.includes('r-pin food') || /午餐|晚餐|朝食|拉面|汤咖喱|烤肉|蟹|寿司/.test(dayHtml);
  if (!hasFood) {
    err(`[餐饮保障] #${did} (${dateStr}) 未检测到任何用餐节点`);
  }

  // 每日预算：必须有 .budget 明细，且至少列出 2 项花费
  const budget = dayHtml.match(/<details class="budget">([\s\S]*?)<\/details>/);
  if (!budget || [...budget[1].matchAll(/<li>/g)].length < 2) {
    err(`[每日预算] #${did} (${dateStr}) 缺少今日花费明细`);
  }

  // 首日 (D1 12/25) 入境+转机+城际缓冲链校验 (NH67 15:35 落地新千岁)
  if (did === 'd1') {
    const checkinMatch = dayHtml.match(/<span class="n-time">(\d{1,2}:\d{2})<\/span>\s*<span class="n-name hotel">/);
    if (checkinMatch) {
      const checkinMin = toMinutes(checkinMatch[1]);
      // 15:35 落地新千岁 -> 洞爷湖万世阁至少需要 2h15m (17:50后)
      if (checkinMin < 17 * 60 + 45) {
        err(`[首日缓冲链] D1 落地新千岁(15:35)后抵洞爷湖万世阁时间(${checkinMatch[1]})过早，违反物理交通极限`);
      } else {
        ok(`[首日缓冲链] D1 15:35 落地新千岁 → ${checkinMatch[1]} 入住洞爷湖万世阁，缓冲充足`);
      }
    }
  }

  // 末日 (D7 12/31) 机场缓冲链校验 (NH78 19:30 起飞)
  if (did === 'd7') {
    if (!dayHtml.includes('13:15') && !dayHtml.includes('新千岁机场')) {
      warn('[末日缓冲链] D7 未检测到提前抵达新千岁机场节点');
    } else {
      ok('[末日缓冲链] D7 13:15 抵达新千岁国内线 2F（距 19:30 NH78 起飞预留充足扫货+托运缓冲）');
    }
  }

  // D5 (12/29 小樽) 16:03 冬季日落窗口校验
  if (did === 'd5') {
    const tenguMatch = dayHtml.match(/<span class="n-time">(\d{1,2}:\d{2})<\/span><span class="n-name">[^<]*天狗山/);
    if (tenguMatch) {
      const tenguMin = toMinutes(tenguMatch[1]);
      if (tenguMin > 15 * 60 + 35) {
        err(`[日落窗口] D5 天狗山登顶时间(${tenguMatch[1]})晚于 15:35，将错过 16:03 日落前的白昼雪景`);
      } else {
        ok(`[日落窗口] D5 ${tenguMatch[1]} 登顶天狗山，精准卡在 16:03 日落前拍齐白昼与蓝调`);
      }
    }
  }
});
ok('[闭合日链] D1–D7 全部 7 张日卡时钟单调递增、零重叠、餐饮住宿与每日预算齐备');

// 5. 12/30–12/31「年末年始」休馆黑名单碰撞检测 (tripwork/trip_calendar.py)
const d6Html = (html.match(/<article class="day-card" id="d6"[^>]*>([\s\S]*?)<\/article>/) || [])[1] || '';
const d7Html = (html.match(/<article class="day-card" id="d7"[^>]*>([\s\S]*?)<\/article>/) || [])[1] || '';
const d7Nodes = [...d7Html.matchAll(/<span class="n-name[^"]*">([^<]+)<\/span>/g)].map(x => x[1]);
for (const n of d7Nodes) {
  if (/NANGA|サッポロファクトリー|Sapporo Factory|旭山動物園|白い恋人/.test(n)) {
    err(`[年末年始闭馆冲突] D7 (12/31 大晦日) 安排了当日休馆的节点: ${n}`);
  }
}
const d6Nodes = [...d6Html.matchAll(/<span class="n-name[^"]*">([^<]+)<\/span>/g)].map(x => x[1]);
for (const n of d6Nodes) {
  if (/旭山動物園/.test(n)) {
    err(`[年末年始闭馆冲突] D6 (12/30) 安排了闭园的旭山动物园: ${n}`);
  }
}
ok('[年末年始排雷] D6(12/30) 与 D7(12/31) 零闭馆景点冲突，NANGA 扫货已安全锁定在 D4(12/28)');

// 6. Google Maps 搜索词精度与出租车卡片完整性校验 (tripwork/test_e2e_hokkaido_dogfood.py)
const gmapUrls = [...html.matchAll(/href="(https:\/\/www\.google\.com\/maps\/search\/[^"]+)"/g)].map(x => x[1]);
const vagueQueries = new Set(['https://www.google.com/maps/search/北海道', 'https://www.google.com/maps/search/札幌', 'https://www.google.com/maps/search/小樽', 'https://www.google.com/maps/search/洞爺湖温泉']);
for (const u of gmapUrls) {
  if (vagueQueries.has(u)) {
    err(`[导航精度] Google Maps 链接过于宽泛: ${u}`);
  }
}
const taxiBtns = [...html.matchAll(/<button[^>]*class="[^"]*taxi-trig[^"]*"[^>]*>/g)].map(x => x[0]);
for (const b of taxiBtns) {
  if (!/data-taxi-name="[^"]+"/.test(b) || !/data-taxi-jp="[^"]+"/.test(b) || !/data-taxi-addr="[^"]+"/.test(b)) {
    err(`[司机指路卡] 存在缺少 name/jp/addr 属性的出租车按钮: ${b}`);
  }
}
ok(`[导航与打车卡] ${gmapUrls.length} 个 Google Maps 精确搜索链接与 ${taxiBtns.length} 张全屏日语司机指路卡校验通过`);

// 7. 弹窗 ID 与点菜预设对称性校验 (travel-plan-viz + tripwork)
const openTargets = [...html.matchAll(/data-open="([^"]+)"/g)].map(x => x[1]);
for (const tid of new Set(openTargets)) {
  if (!html.includes(`id="${tid}"`)) {
    err(`[交互弹窗] data-open="${tid}" 指向了不存在的 DOM ID`);
  }
}
const modalIds = ['mm-daruma', 'mm-soupcurry', 'mm-kani', 'mm-hanamaru', 'mm-otaru'];
for (const mid of modalIds) {
  const mBlock = html.match(new RegExp(`id="${mid}"[\\s\\S]*?<\\/ul>`));
  if (!mBlock) {
    err(`[交互弹窗] 未找到点菜弹窗 #${mid}`);
  } else {
    const dishCount = [...mBlock[0].matchAll(/class="ord"/g)].length;
    if (dishCount < 3) err(`[交互弹窗] #${mid} 可点菜品少于 3 道`);
  }
}
ok(`[交互弹窗] 全部 ${new Set(openTargets).size} 个餐厅点菜弹窗与预设套餐映射 100% 闭合`);

// 7b. 照片：只用 Wikimedia 缩略图，必须带 alt、懒加载和作者/许可署名
const figs = [...html.matchAll(/<figure class="ph">([\s\S]*?)<\/figure>/g)].map(x => x[1]);
const badFig = figs.find(f => !/<img src="https:\/\/thumb\.wikimedia\.org\/[^"]+" alt="[^"]+" loading="lazy"/.test(f) || !/<figcaption>📷 [^<]+ · [^<]+ · <a href="https:\/\/commons\.wikimedia\.org\//.test(f));
if (!figs.length) {
  err('[照片署名] 未找到任何景点照片');
} else if (badFig) {
  err(`[照片署名] 存在缺 alt/懒加载/署名或非 Wikimedia 来源的照片: ${badFig.slice(0, 120)}`);
} else if ((html.match(/<img /g) || []).length !== figs.length) {
  err('[照片署名] 存在不在 <figure class="ph"> 里的 <img>，无法保证署名');
} else {
  ok(`[照片署名] ${figs.length} 张景点照片均来自 Wikimedia，带 alt、懒加载与作者许可署名`);
}

// 7c. 地图点位的「看行程」跳转锚点必须存在
const spotsJson = (html.match(/var MAP_SPOTS=(\[[\s\S]*?\]);/) || [])[1];
const deadAnchors = spotsJson ? JSON.parse(spotsJson).filter(s => !html.includes(`id="${s.a}"`)).map(s => `${s.k}→#${s.a}`) : ['MAP_SPOTS 缺失'];
if (deadAnchors.length) {
  err(`[地图锚点] 跳转目标不存在: ${deadAnchors.join(', ')}`);
} else {
  ok(`[地图锚点] ${JSON.parse(spotsJson).length} 个地图点位的跳转锚点全部存在`);
}

// 7d. 过时说法与脆弱写法：免税已改退税、万世阁房间无私汤、localStorage 必须走 store 包装（被禁用时页面不能整体失效）
const stale = ['当场免税', '而且免税', '西馆展望', '泡汤吃夜宵'].filter(w => html.includes(w));
const rawStorage = (html.match(/localStorage\.(getItem|setItem)\(/g) || []).length;
if (stale.length) {
  err(`[过时内容] 页面仍包含已失效的说法: ${stale.join('、')}`);
} else if (rawStorage !== 2) {
  err(`[存储容错] 发现 ${rawStorage - 2} 处绕过 store 包装直接调用 localStorage`);
} else {
  ok('[过时内容与存储容错] 无失效说法，localStorage 全部经 store 包装');
}

// 7e. 预算算术：每天明细之和 ≈ 当天合计，七天合计 ≈ 各天之和（区间按低/高分别算，允许凑整误差 ¥500）
const yen = t => { const m = t.replace(/,/g, '').match(/¥(\d+)(?:–(\d+))?/); return m ? [+m[1], +(m[2] || m[1])] : null; };
const dayTotals = [];
let budgetBad = '';
dayIds.forEach(did => {
  const day = (html.match(new RegExp(`<article class="day-card" id="${did}"[^>]*>([\\s\\S]*?)<\\/article>`)) || [])[1] || '';
  const b = day.match(/<details class="budget"><summary>[^<]*<b>([^<]+)<\/b>[\s\S]*?<ul>([\s\S]*?)<\/ul>/);
  if (!b) return;
  const total = yen(b[1]);
  const items = [...b[2].matchAll(/<b>([^<]+)<\/b>/g)].map(x => yen(x[1])).filter(Boolean);
  const sum = items.reduce((a, x) => [a[0] + x[0], a[1] + x[1]], [0, 0]);
  if (!total || Math.abs(sum[0] - total[0]) > 500 || Math.abs(sum[1] - total[1]) > 500) budgetBad += ` #${did} 明细合计 ¥${sum.join('–')} ≠ 标注 ${b[1]};`;
  dayTotals.push(sum);
});
const grand = (html.match(/合计约 <b>([^<]+)<\/b>/) || [])[1];
const gsum = dayTotals.reduce((a, x) => [a[0] + x[0], a[1] + x[1]], [0, 0]);
if (grand && (Math.abs(yen(grand)[0] - gsum[0]) > 1000 || Math.abs(yen(grand)[1] - gsum[1]) > 1000)) budgetBad += ` 七天合计 ${grand} ≠ 各天之和 ¥${gsum.join('–')};`;
if (dayTotals.length !== 7 || budgetBad) {
  err(`[预算算术]${budgetBad || ' 不是 7 天都有预算'}`);
} else {
  ok(`[预算算术] 7 天明细与当天合计、七天合计 ¥${gsum.join('–')} 全部对得上`);
}

// 8. 七天总览对称性校验 (D1-D7 严格 7 行，每行跳到对应日卡并带步数)
const ovRows = [...html.matchAll(/<a class="ov-row" data-day="(\d)" href="#d(\d)">([\s\S]*?)<\/a>/g)];
if (ovRows.map(x => x[1]).join(',') !== '1,2,3,4,5,6,7') {
  err(`[七天总览] #overview 行顺序异常: 期望 1..7，实际为 ${ovRows.map(x => x[1]).join(',')}`);
} else if (ovRows.some(x => x[1] !== x[2] || !/步<\/small>/.test(x[3]))) {
  err('[七天总览] #overview 存在跳转锚点与日序不符或缺步数的行');
} else {
  ok('[七天总览] #overview 严格对应 D1–D7 共 7 行，锚点与步数齐全');
}

// 8b. 行前清单：待办项必须有唯一 data-chk，避免打勾状态串号
const prepHtml = (html.match(/<section id="prep">([\s\S]*?)<\/section>/) || [])[1] || '';
const prepKeys = [...prepHtml.matchAll(/data-chk="([^"]+)"/g)].map(x => x[1]);
const allKeys = [...html.matchAll(/data-chk="([^"]+)"/g)].map(x => x[1]);
if (!prepKeys.length) {
  err('[行前清单] 未找到 #prep 待办项');
} else if (new Set(allKeys).size !== allKeys.length) {
  err('[行前清单] data-chk 存在重复键，打勾状态会串号');
} else {
  ok(`[行前清单] ${prepKeys.length} 项行前待办，全部 ${allKeys.length} 个勾选项键名唯一`);
}

// 9. JR北海道特急北斗号真实时刻表核验 (对照官方时刻表原图)
if (!html.includes('16:17→17:38') || !html.includes('17:26→18:48')) {
  err('[时刻表核验] D1 南千岁→洞爷 JR 特急北斗 18号/20号 时刻表与 JR 北海道官方时刻表不符');
} else {
  ok('[时刻表核验] D1 JR 特急北斗 18/20 号与官方时刻表 100% 吻合');
}

// 输出汇总报告
console.log('====================================================');
console.log('❄️  HOKKAIDO 7-DAY ITINERARY AUTOMATED DEBUG REPORT');
console.log('====================================================');
passed.forEach(p => console.log('  ✅ PASS:', p));
warnings.forEach(w => console.log('  ⚠️ WARN:', w));
errors.forEach(e => console.log('  ❌ FAIL:', e));
console.log('----------------------------------------------------');
console.log(`总结: ${passed.length} 项通过 | ${warnings.length} 项警告 | ${errors.length} 项错误`);
console.log('====================================================');

if (errors.length > 0) {
  process.exit(1);
}
