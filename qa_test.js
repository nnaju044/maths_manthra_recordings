const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Navigating to login...');
  await page.goto('http://localhost:3000/auth/login');
  await page.fill('input[name="email"]', 'admin@mathsmantras.com');
  await page.fill('input[name="password"]', 'Admin@123');
  await page.click('button[type="submit"]');

  console.log('Logged in. Verifying edge cases...');
  
  // 1. Create a course without videos
  console.log('--- Test 1: Course without videos ---');
  await page.goto('http://localhost:3000/admin/courses/create');
  await page.fill('input[name="title"]', 'Test Empty Course');
  await page.fill('input[name="password"]', '1111');
  await page.click('button[type="submit"]');
  
  // Wait for redirect to /admin/courses
  await page.waitForURL('http://localhost:3000/admin/courses');
  const courseCountText = await page.locator('text=Test Empty Course').count();
  console.log(`Course created successfully. Found ${courseCountText} instances on page.`);

  // Find the edit button for the new course to get its ID, or just navigate to videos
  // Actually we can just check if we can create a video without a title.

  // 2. Video without title
  console.log('--- Test 2: Video without title ---');
  await page.goto('http://localhost:3000/admin/videos/create');
  // Need to select a course first. We can select any option that is not empty.
  const courseOptions = await page.locator('select[name="courseId"] option').elementHandles();
  if (courseOptions.length > 1) {
    const value = await courseOptions[1].getAttribute('value');
    await page.selectOption('select[name="courseId"]', value);
  }
  
  await page.fill('input[name="dayNumber"]', '1');
  // Leave title empty
  await page.fill('input[name="youtubeUrl"]', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  
  // Try to submit
  await page.click('button[type="submit"]');
  
  // Check if HTML5 validation stopped it
  const titleInput = page.locator('input[name="title"]');
  const isTitleInvalid = await titleInput.evaluate(node => !node.validity.valid);
  console.log(`Title HTML5 validation caught empty title: ${isTitleInvalid}`);

  // 3. Video with invalid YouTube URL
  console.log('--- Test 3: Video with invalid YouTube URL ---');
  await page.goto('http://localhost:3000/admin/videos/create');
  
  const courseOptions2 = await page.locator('select[name="courseId"] option').elementHandles();
  if (courseOptions2.length > 1) {
    const value = await courseOptions2[1].getAttribute('value');
    await page.selectOption('select[name="courseId"]', value);
  }
  await page.fill('input[name="dayNumber"]', '2');
  await page.fill('input[name="title"]', 'Test Video Invalid URL');
  await page.fill('input[name="youtubeUrl"]', 'not-a-url');
  
  await page.click('button[type="submit"]');
  const urlInput = page.locator('input[name="youtubeUrl"]');
  const isUrlInvalid = await urlInput.evaluate(node => !node.validity.valid);
  console.log(`URL HTML5 validation caught invalid URL: ${isUrlInvalid}`);

  // Test backend validation bypass by removing required attribute and type=url
  console.log('--- Test 3.1: Bypassing HTML5 for Invalid URL ---');
  await urlInput.evaluate(node => { node.type = 'text'; });
  await page.click('button[type="submit"]');
  
  // We should either see a flash message error or be still on the same page.
  await page.waitForTimeout(1000);
  const flashError = await page.locator('.alert-danger').count();
  if (flashError > 0) {
    const errorMsg = await page.locator('.alert-danger').textContent();
    console.log(`Backend validation caught invalid URL: ${errorMsg.trim()}`);
  } else {
    console.log(`Backend validation might have missed it or we were redirected. Current URL: ${page.url()}`);
  }

  await browser.close();
  console.log('Finished testing edge cases.');
})();
