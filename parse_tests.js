const fs = require('fs');
try {
  const txt = fs.readFileSync('tests.json', 'utf16le');
  const startIndex = txt.indexOf('{');
  if (startIndex === -1) {
    fs.writeFileSync('tests_summary.txt', 'No JSON found in tests.json');
    process.exit(0);
  }
  const data = JSON.parse(txt.substring(startIndex));
  const failed = data.testResults.filter(r => r.status === 'failed');
  let summary = '';
  failed.forEach(f => {
    summary += 'Suite: ' + f.name + '\n';
    f.assertionResults.filter(a => a.status === 'failed').forEach(a => {
      summary += ' -> ' + a.title + '\n';
      summary += a.failureMessages.join('\n') + '\n\n';
    });
  });
  if (!summary) summary = 'All tests passed!';
  fs.writeFileSync('tests_summary.txt', summary);
} catch (e) {
  fs.writeFileSync('tests_summary.txt', 'Error: ' + e.message);
}
