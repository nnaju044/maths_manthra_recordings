const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

async function measure() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  const bgBuf = fs.readFileSync('public/images/certificate-template.jpg');
  const bgDataUri = 'data:image/jpeg;base64,' + bgBuf.toString('base64');

  await page.setContent(`
    <!DOCTYPE html>
    <html>
    <body>
      <canvas id="cvs" width="4800" height="3200"></canvas>
      <script>
        const img = new Image();
        img.src = "${bgDataUri}";
        img.onload = () => {
          const cvs = document.getElementById('cvs');
          const ctx = cvs.getContext('2d');
          ctx.drawImage(img, 0, 0);

          const imgData = ctx.getImageData(0, 0, 4800, 3200);
          const data = imgData.data;

          function getPixel(x, y) {
            const idx = (y * 4800 + x) * 4;
            return {
              r: data[idx],
              g: data[idx + 1],
              b: data[idx + 2],
              a: data[idx + 3]
            };
          }

          // 1. QR Code gold box:
          // Look around x: 200..1200, y: 500..1800 for the gold border lines
          // Gold color typically has high R, medium G, low B (e.g., r>160, g>120, b<80)
          let qrBox = { minX: 9999, maxX: 0, minY: 9999, maxY: 0 };
          for (let y = 600; y < 1400; y += 2) {
            for (let x = 300; x < 1200; x += 2) {
              const p = getPixel(x, y);
              // Gold border detection
              if (p.r > 160 && p.g > 110 && p.g < 170 && p.b < 80) {
                if (x < qrBox.minX) qrBox.minX = x;
                if (x > qrBox.maxX) qrBox.maxX = x;
                if (y < qrBox.minY) qrBox.minY = y;
                if (y > qrBox.maxY) qrBox.maxY = y;
              }
            }
          }

          // 2. Name underline:
          // Horizontal line across the middle x: 1500..3500, y: 1600..2000
          // Let's find rows with a continuous dark/gold line
          let nameLineY = null;
          let nameLineX1 = null, nameLineX2 = null;
          for (let y = 1600; y < 1950; y++) {
            let lineCount = 0;
            for (let x = 1600; x < 3200; x++) {
              const p = getPixel(x, y);
              // Line color is gold / dark gold
              if (p.r > 150 && p.g > 110 && p.b < 80) {
                lineCount++;
              }
            }
            if (lineCount > 800) {
              nameLineY = y;
              break;
            }
          }

          // 3. Date line (left signature line) & Signature line (right)
          // Search around y: 2000..2600
          let dateLineY = null;
          let sigLineY = null;
          for (let y = 2200; y < 2500; y++) {
            let leftLine = 0;
            let rightLine = 0;
            for (let x = 1000; x < 2000; x++) {
              const p = getPixel(x, y);
              if (p.r > 150 && p.g > 110 && p.b < 80) leftLine++;
            }
            for (let x = 2800; x < 3800; x++) {
              const p = getPixel(x, y);
              if (p.r > 150 && p.g > 110 && p.b < 80) rightLine++;
            }
            if (leftLine > 400 && !dateLineY) dateLineY = y;
            if (rightLine > 400 && !sigLineY) sigLineY = y;
          }

          // 4. Look for text "Certificate ID:" and "Date of Completion:"
          // Text is dark blue/navy (r < 50, g < 60, b < 90)
          // Let's scan y: 2500..2900, x: 200..1500
          let certIdBox = { minX: 9999, maxX: 0, minY: 9999, maxY: 0 };
          for (let y = 2550; y < 2750; y++) {
            for (let x = 300; x < 1200; x++) {
              const p = getPixel(x, y);
              if (p.r < 40 && p.g < 50 && p.b < 80) {
                if (x < certIdBox.minX) certIdBox.minX = x;
                if (x > certIdBox.maxX) certIdBox.maxX = x;
                if (y < certIdBox.minY) certIdBox.minY = y;
                if (y > certIdBox.maxY) certIdBox.maxY = y;
              }
            }
          }

          let compDateBox = { minX: 9999, maxX: 0, minY: 9999, maxY: 0 };
          for (let y = 2700; y < 2900; y++) {
            for (let x = 300; x < 1200; x++) {
              const p = getPixel(x, y);
              if (p.r < 40 && p.g < 50 && p.b < 80) {
                if (x < compDateBox.minX) compDateBox.minX = x;
                if (x > compDateBox.maxX) compDateBox.maxX = x;
                if (y < compDateBox.minY) compDateBox.minY = y;
                if (y > compDateBox.maxY) compDateBox.maxY = y;
              }
            }
          }

          window.measurements = {
            qrBox,
            nameLineY,
            dateLineY,
            sigLineY,
            certIdBox,
            compDateBox
          };
          window.ready = true;
        };
      </script>
    </body>
    </html>
  `);

  await page.waitForFunction('window.ready === true');
  const m = await page.evaluate(() => window.measurements);
  console.log('Raw 4800x3200 measurements:', JSON.stringify(m, null, 2));

  // Convert to mm (297mm width, 210mm height)
  // mmX = (pxX / 4800) * 297
  // mmY = (pxY / 3200) * 210
  const toMmX = (x) => ((x / 4800) * 297).toFixed(1);
  const toMmY = (y) => ((y / 3200) * 210).toFixed(1);

  console.log('\nConverted to mm for 297mm x 210mm A4:');
  console.log('QR Box:', {
    left: toMmX(m.qrBox.minX) + 'mm',
    top: toMmY(m.qrBox.minY) + 'mm',
    width: toMmX(m.qrBox.maxX - m.qrBox.minX) + 'mm',
    height: toMmY(m.qrBox.maxY - m.qrBox.minY) + 'mm',
  });
  console.log('Name line Y:', toMmY(m.nameLineY) + 'mm');
  console.log('Date line Y:', toMmY(m.dateLineY) + 'mm');
  console.log('Signature line Y:', toMmY(m.sigLineY) + 'mm');
  console.log('Certificate ID label box:', {
    minX: toMmX(m.certIdBox.minX) + 'mm',
    maxX: toMmX(m.certIdBox.maxX) + 'mm',
    minY: toMmY(m.certIdBox.minY) + 'mm',
    maxY: toMmY(m.certIdBox.maxY) + 'mm',
  });
  console.log('Date of Completion label box:', {
    minX: toMmX(m.compDateBox.minX) + 'mm',
    maxX: toMmX(m.compDateBox.maxX) + 'mm',
    minY: toMmY(m.compDateBox.minY) + 'mm',
    maxY: toMmY(m.compDateBox.maxY) + 'mm',
  });

  await browser.close();
}

measure().catch(console.error);
