const fs = require('fs');
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:3001'); // Replace with actual URL if different
  
  const data = await page.evaluate(() => {
    return {
      authoring: localStorage.getItem('racehorse:lesson-v2:authoring:v1'),
      frozen: localStorage.getItem('racehorse:lesson-v2:frozen:v1')
    };
  });

  fs.writeFileSync('ls_dump.json', JSON.stringify(data, null, 2));
  await browser.close();
})();
