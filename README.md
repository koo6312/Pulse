# RESCENE PULSE 판매량 트래커

리센느 미니 4집 **PULSE**(2026.11.03 발매)의 초동 판매량을 보여주는 팬 제작 비공식 페이지입니다.

- 숫자: [한터차트 실시간 음반차트](https://www.hanteochart.com/ko/charts/album/real)의 PULSE 버전별 **판매량** 열 합계
- 갱신: GitHub Actions가 30분마다 차트 페이지를 열어 읽고(`scripts/collect.js`), 판매량이 바뀌면 `data/history.json`에 기록
- 일별 판매량은 하루 중 가장 큰 값, 누적은 그 합으로 계산합니다 (실시간 차트가 매일 자정에 초기화된다는 가정, `index.html`의 `RESET_DAILY`)
- 실시간 차트 100위 안에 든 버전만 집계되므로 한터 공식 초동 집계와 다를 수 있습니다

## 로컬 실행

```bash
npm install
node scripts/collect.js   # data/ 갱신
npx serve .               # index.html 확인
```
