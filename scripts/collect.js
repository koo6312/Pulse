// 한터 실시간 음반차트(공개 페이지)를 헤드리스 브라우저로 열어 리센느 PULSE 버전별 판매량을 읽는다.
// 판매량이 바뀌었을 때만 data/history.json에 스냅샷을 추가하고, data/status.json에는 매번 마지막 확인 시각을 남긴다.
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const URL = 'https://www.hanteochart.com/ko/charts/album/real';
const MATCH = { album: 'PULSE', artist: '리센느' };
// 데이터는 data 브랜치에 둔다 (Actions는 그 브랜치를 DATA_DIR에 체크아웃). 로컬 기본값은 ./data
const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const num = s => Number(String(s).replace(/,/g, '')) || 0;
const readJson = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };

async function scrape() {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1000 });
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
    // 판매량 열은 페이지가 따로 불러와 채운다 — 첫 줄 판매량이 숫자가 될 때까지 대기
    await page.waitForFunction(() => {
      const s = document.querySelector('.chart-real .rank-data .stat-container .left');
      return s && /\d/.test(s.textContent);
    }, { timeout: 30000 });
    // 기본 20위까지만 보이므로 '더보기'를 눌러 100위까지 펼친다
    for (let i = 0; i < 6; i++) {
      const more = await page.$$eval('.chart-real *', els => {
        const b = els.filter(e => e.textContent.trim() === '더보기').map(e => e.closest('button,a,[role=button]') || e).pop();
        if (b) { b.click(); return true; }
        return false;
      });
      if (!more) break;
      await new Promise(r => setTimeout(r, 600));
    }
    return await page.evaluate(() => {
      const when = (document.querySelector('.chart-real .chart-resultDatetime') || {}).textContent || '';
      const rows = [...document.querySelectorAll('.chart-real .rank-data')].map(el => ({
        rank: Number(el.querySelector('.rank-container .top')?.textContent.trim()),
        name: el.querySelector('.row-container .top')?.textContent.trim(),
        artist: el.querySelector('.row-container .bottom pre')?.textContent.trim(),
        sales: el.querySelector('.stat-container .left')?.textContent.trim(),
        index: el.querySelector('.stat-container .right')?.textContent.trim(),
      }));
      return { when: (when.match(/\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}/) || [''])[0], rows };
    });
  } finally {
    await browser.close();
  }
}

(async () => {
  const snap = await scrape();
  if (!snap.rows.length) throw new Error('chart rows not found');
  const versions = snap.rows
    .filter(r => r.name && r.name.includes(MATCH.album) && r.artist === MATCH.artist)
    .map(r => ({
      rank: r.rank,
      version: (r.name.match(/,\s*([^,]+?)\s*ver\.?$/i) || [, 'Standard'])[1],
      sales: num(r.sales),
      index: num(r.index),
    }));
  const entry = {
    fetchedAt: new Date().toISOString(),
    aggregatedAt: snap.when,
    chartSize: snap.rows.length,
    versions,
    totalSales: versions.reduce((a, v) => a + v.sales, 0),
  };

  fs.mkdirSync(DATA, { recursive: true });
  const histFile = path.join(DATA, 'history.json');
  const history = readJson(histFile, []);
  const prev = history[history.length - 1];
  const key = e => JSON.stringify(e.versions.map(v => [v.version, v.sales]).sort());
  const sameDay = prev && prev.aggregatedAt.slice(0, 10) === entry.aggregatedAt.slice(0, 10);
  const changed = !prev || !sameDay || key(prev) !== key(entry);
  if (changed) {
    history.push(entry);
    fs.writeFileSync(histFile, JSON.stringify(history, null, 1) + '\n', 'utf8');
  }
  fs.writeFileSync(path.join(DATA, 'status.json'), JSON.stringify({
    lastChecked: entry.fetchedAt, aggregatedAt: entry.aggregatedAt, totalSales: entry.totalSales, changed,
  }, null, 1) + '\n', 'utf8');
  console.log(`${entry.aggregatedAt} total ${entry.totalSales} (${versions.map(v => `${v.version} ${v.sales}`).join(', ')})${changed ? ' [saved]' : ' [no change]'}`);
})().catch(e => { console.error('collect failed:', e.message); process.exit(1); });
