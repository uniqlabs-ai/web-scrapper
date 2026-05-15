const fs = require('fs');
const content = fs.readFileSync('vitest_output.txt', 'utf8');
console.log(content);
