#!/usr/bin/env node
/**
 * 產生 district-config.js（讓 index.html 讀取的地區設定）。
 *
 * 用法：
 *   node scripts/build-config.js                 → 用 DISTRICT_CODE 環境變數（預設 3523）找 config/districts/<代號>.json
 *   DISTRICT_CODE=3481 node scripts/build-config.js
 *   DISTRICT_CONFIG_FILE=/path/to/x.json node scripts/build-config.js   → 直接指定檔案（測試用）
 *
 * 3523 版的 district-config.js 已放在 git 裡當預設值，所以本機直接開 index.html、GitHub Pages、
 * 現有 Vercel 專案都不需要跑這支腳本；其他地區的 Vercel 專案會在部署時由 vercel.json 自動執行。
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const code = (process.env.DISTRICT_CODE || '3523').trim();
const file = process.env.DISTRICT_CONFIG_FILE || path.join(root, 'config', 'districts', `${code}.json`);

if (!fs.existsSync(file)) {
  console.error(`❌ 找不到地區設定檔：${file}\n   請先建立 config/districts/${code}.json（可複製 config/districts/_template.json）`);
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
delete cfg['_說明'];

const required = ['code', 'name', 'nameEn', 'shortTitle', 'rotaryYear', 'rotaryYearLong', 'logo', 'divisions'];
const missing = required.filter((k) => cfg[k] === undefined || cfg[k] === '' || cfg[k] === null);
if (missing.length) {
  console.error(`❌ 地區設定檔缺少欄位：${missing.join(', ')}（${file}）`);
  process.exit(1);
}
if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
  console.warn('⚠️  supabaseUrl / supabaseAnonKey 是空的：網頁會以「本機儲存」模式運作，資料不會同步到雲端（只適合本機測試）');
}
if (!Array.isArray(cfg.divisions) || !cfg.divisions.length) {
  console.error('❌ divisions 必須是至少一個分區的陣列');
  process.exit(1);
}
if (!cfg.divisions.some((d) => d.name === '地區團隊')) {
  console.warn('⚠️  divisions 裡沒有「地區團隊」分區（地區辦公室用來擔任活動主委），建議保留');
}

const out = `// 由 scripts/build-config.js 自動產生，請改 config/districts/${cfg.code}.json 再重新產生，不要直接編輯本檔。
window.DISTRICT = ${JSON.stringify(cfg, null, 2)};
`;
fs.writeFileSync(path.join(root, 'district-config.js'), out);
const clubs = cfg.divisions.reduce((a, d) => a + (d.clubs || []).length, 0);
console.log(`✅ district-config.js 已產生：${cfg.name}（代號 ${cfg.code}，${cfg.divisions.length} 分區 ${clubs} 社）`);
