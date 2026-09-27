const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const QRCode = require('qrcode');

async function testRender() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  // 297mm x 210mm at 150 DPI: 1754 x 1240
  await page.setViewport({ width: 1754, height: 1240 });

  const bgPath = path.resolve('public/images/certificate-template.jpg');
  const sigPath = path.resolve('public/images/Signature_smija.png');
  const bgDataUri = 'data:image/jpeg;base64,' + fs.readFileSync(bgPath).toString('base64');
  const sigDataUri = 'data:image/png;base64,' + fs.readFileSync(sigPath).toString('base64');

  const verifyUrl = 'http://localhost:3000/certificate?cert=MMC-2026-A09434-9710';
  const qrSvg = await QRCode.toString(verifyUrl, {
    type: 'svg',
    margin: 1,
    color: { dark: '#000000', light: '#ffffff' }
  });

  // Render template with new coordinates
  const templatePath = path.resolve('views/course/certificate-pdf.ejs');
  const html = await ejs.renderFile(templatePath, {
    bgImagePath: bgDataUri,
    signaturePath: sigDataUri,
    qrCode: qrSvg,
    studentName: 'Najeeb',
    issuedDate: '27 Sept 2026',
    certificateNumber: 'MMC-2026-A09434-9710',
    completionDate: '30 September 2026'
  });

  await page.setContent(html, { waitUntil: 'networkidle0' });

  // Generate test PDF
  const pdfBuffer = await page.pdf({
    format: 'A4',
    landscape: true,
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' }
  });

  fs.writeFileSync('debug-test-certificate.pdf', pdfBuffer);
  console.log('Saved debug-test-certificate.pdf (size:', pdfBuffer.length, 'bytes)');

  // Also take a high-res PNG screenshot so we can verify the alignment visually
  await page.screenshot({
    path: 'debug-test-certificate.png',
    fullPage: true
  });
  console.log('Saved debug-test-certificate.png');

  await browser.close();
}

testRender().catch(console.error);
