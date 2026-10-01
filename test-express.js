const express = require('express');
console.log('Express version:', require('express/package.json').version);
console.log('express.json type:', typeof express.json);

// Quick test
const app = express();
app.use(express.json());
app.post('/test', (req, res) => {
  console.log('Body:', req.body);
  res.json({ received: req.body });
});

const server = app.listen(3999, () => {
  const http = require('http');
  const data = JSON.stringify({ url: 'test123' });
  const req = http.request({
    hostname: 'localhost',
    port: 3999,
    path: '/test',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
  }, (res) => {
    let body = '';
    res.on('data', d => body += d);
    res.on('end', () => {
      console.log('Response:', body);
      server.close();
      process.exit(0);
    });
  });
  req.write(data);
  req.end();
});
