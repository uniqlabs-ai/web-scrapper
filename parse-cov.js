const fs = require('fs');
const cov = JSON.parse(fs.readFileSync('coverage/coverage-final.json', 'utf8'));
for (const key in cov) {
  if (key.includes('api/import/smart/route.ts')) {
    const fileCov = cov[key];
    const b = fileCov.b;
    const branchMap = fileCov.branchMap;
    for (const bId in b) {
      const counts = b[bId];
      if (counts.some(c => c === 0)) {
        console.log('Uncovered branch line:', branchMap[bId].loc.start.line);
      }
    }
  }
}
