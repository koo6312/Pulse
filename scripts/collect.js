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
// 'PULSE: 미니앨범 4집, Standard ver.' → 'Standard'. 형식이 다르게 올라와도(괄호·Edition 등) 다른 버전과 섞이지 않도록
// 못 읽으면 앨범명 전체를 버전 이름으로 쓴다 — Standard로 몰면 같은 이름 두 줄이 생겨 합계와 리셋 판정이 꼬인다
function versionOf(name) {
  let v = (name.match(/,\s*([^,]+)$/) || name.match(/[(\[]([^)\]]+)[)\]]\s*$/) || [, ''])[1];
  v = v.replace(/\s*[(\[][^)\]]*[)\]]\s*$/, '').replace(/\s*\b(ver(sion)?\.?|edition)\s*$/i, '').trim();
  if (/limited|리미티드/i.test(v)) return 'Limited';
  return v || name;
}
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
      version: versionOf(r.name),
      name: r.name,
      sales: num(r.sales),
      index: num(r.index),
    }));
  // 같은 버전 이름이 두 줄이면 각자 원래 앨범명으로 구분한다
  const dup = new Set(versions.map(v => v.version).filter((x, i, a) => a.indexOf(x) !== i));
  for (const v of versions) if (dup.has(v.version)) v.version = v.name;
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
  // 한터가 가끔 옛 차트(예: 11/3 18:30에 9/29 차트)를 내려준다 → 집계 시각이 뒤로 가면 저장하지 않는다
  if (!snap.when) throw new Error('chart time not found');
  if (prev && entry.aggregatedAt < prev.aggregatedAt) throw new Error(`stale chart ${entry.aggregatedAt} < ${prev.aggregatedAt}`);
  // 초동이 끝나면 PULSE가 100위 밖으로 밀려날 수 있다. 100위까지 다 읽은 차트에 PULSE가 없으면 버전 없는 기록으로 남긴다
  // (페이지는 새 날짜에 이 기록이 오면 그날 초기화로 본다). 더보기가 덜 펼쳐져 100줄이 안 되면 판단하지 않는다.
  if (!versions.length && snap.rows.length < 100) throw new Error(`no PULSE rows in ${snap.rows.length} rows (aggregatedAt ${snap.when})`);
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
