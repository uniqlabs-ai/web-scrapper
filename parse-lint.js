const fs = require('fs');
const content = fs.readFileSync('lint.json', 'utf8');
const data = JSON.parse(content.substring(content.indexOf('[')));
const filesByRule = {};
data.forEach(f => {
  if (!f.messages) return;
  const path = f.filePath.split('/src/')[1] || f.filePath.split('/').pop();
  f.messages.forEach(m => {
    if(m.ruleId && m.ruleId.startsWith('react-hooks/')) {
      if(!filesByRule[m.ruleId]) filesByRule[m.ruleId] = [];
      filesByRule[m.ruleId].push(path + ':' + m.line + ' ' + m.message.replace(/\n| /g, ' ').substring(0, 70));
    }
  });
});
console.log('\n--- purity ---');
(filesByRule['react-hooks/purity'] || []).forEach(x => console.log(x));
console.log('\n--- set-state-in-effect ---');
(filesByRule['react-hooks/set-state-in-effect'] || []).forEach(x => console.log(x));
console.log('\n--- immutability ---');
(filesByRule['react-hooks/immutability'] || []).forEach(x => console.log(x));
console.log('\n--- exhaustive-deps ---');
(filesByRule['react-hooks/exhaustive-deps'] || []).forEach(x => console.log(x));
