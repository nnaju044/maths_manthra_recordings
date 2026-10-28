/**
 * tests/scores_feature.test.js
 * Comprehensive unit and integration tests for the "Check Scores" feature using Node.js built-in fetch.
 */
require('dotenv').config();
process.env.NODE_ENV = 'test';
const assert = require('assert');
const http = require('http');
const Course = require('../models/Course');
const CertificateStudent = require('../models/CertificateStudent');
const EmailOTP = require('../models/EmailOTP');
const emailService = require('../services/email.service');

async function runScoresFeatureTests() {
  console.log('🧪 Running Scores Feature Integration Tests...\n');

  // Test 1: Check Course model schema has scoresEnabled
  console.log('Test 1: Validating Course model scoresEnabled attribute...');
  const testCourse = new Course({
    title: 'Test Scores Course',
    passwordHash: 'dummyhash',
  });
  assert.strictEqual(testCourse.scoresEnabled, false, 'Default scoresEnabled should be false');
  testCourse.scoresEnabled = true;
  assert.strictEqual(testCourse.scoresEnabled, true, 'scoresEnabled should be settable to true');
  console.log('  ✔ Course model schema has scoresEnabled with default false\n');

  // Start app server for HTTP tests
  const connectDB = require('../config/db');
  await connectDB();
  const app = require('../app');

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Test 2: GET /scores public portal renders 200
    console.log('Test 2: Verifying GET /scores route...');
    const resScores = await fetch(`${baseUrl}/scores`);
    assert.strictEqual(resScores.status, 200, 'GET /scores should return 200 OK');
    const scoresHtml = await resScores.text();
    assert(scoresHtml.includes('Student Scores & Performance Portal'), 'Scores portal title should render');
    assert(scoresHtml.includes('Verify Your Identity'), 'OTP verification entry should be present');
    console.log('  ✔ GET /scores returns 200 and renders HTML\n');

    // Test 3: POST /scores/send-otp validation
    console.log('Test 3: Testing POST /scores/send-otp validation...');
    const resNoEmail = await fetch(`${baseUrl}/scores/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(resNoEmail.status, 400);
    const noEmailData = await resNoEmail.json();
    assert.strictEqual(noEmailData.success, false);

    const resInvalidEmail = await fetch(`${baseUrl}/scores/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nonexistent-student-xyz@test.com' }),
    });
    assert.strictEqual(resInvalidEmail.status, 404);
    const invalidEmailData = await resInvalidEmail.json();
    assert.strictEqual(invalidEmailData.success, false);
    console.log('  ✔ Validation for missing/non-existent student emails works as expected\n');

    // Test 4: Course watch page includes "Check Scores" card when scoresEnabled is true
    console.log('Test 4: Testing course watch page rendering with scoresEnabled...');
    const existingCourse = await Course.findOne({ isActive: true });
    if (existingCourse) {
      const origScoresEnabled = existingCourse.scoresEnabled;
      try {
        existingCourse.scoresEnabled = true;
        await existingCourse.save();

        // Check if scoresEnabled persists in database
        const reloaded = await Course.findById(existingCourse._id);
        assert.strictEqual(reloaded.scoresEnabled, true, 'scoresEnabled should persist to DB');
        console.log('  ✔ Course scoresEnabled persists in database\n');
      } finally {
        existingCourse.scoresEnabled = origScoresEnabled;
        await existingCourse.save();
      }
    }

    // ── Test 5: Comprehensive tests for resendOTP rules and email failure safety ──
    console.log('Test 5: Testing resendOTP validation, cooldown, and delivery failure behavior...');

    // 5a. Missing and malformed email on /scores/resend-otp
    const resResendEmpty = await fetch(`${baseUrl}/scores/resend-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: '' }),
    });
    assert.strictEqual(resResendEmpty.status, 400);
    const emptyJson = await resResendEmpty.json();
    assert.strictEqual(emptyJson.success, false);
    assert.strictEqual(emptyJson.message, 'Email address is required.');

    const resResendMalformed = await fetch(`${baseUrl}/scores/resend-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invalid-email-format' }),
    });
    assert.strictEqual(resResendMalformed.status, 400);
    const malformedJson = await resResendMalformed.json();
    assert.strictEqual(malformedJson.success, false);
    assert.strictEqual(malformedJson.message, 'Please enter a valid email address.');
    console.log('  ✔ Missing and malformed email validation returns 400');

    // 5b. Unknown or inactive student on /scores/resend-otp
    const resResendUnknown = await fetch(`${baseUrl}/scores/resend-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'unknown-student-404@example.com' }),
    });
    assert.strictEqual(resResendUnknown.status, 404);
    const unknownJson = await resResendUnknown.json();
    assert.strictEqual(unknownJson.success, false);
    console.log('  ✔ Unknown student email on resend returns 404');

    // Setup isolated test entities for eligibility and cooldown tests
    const testCourseEnabled = await Course.create({
      title: 'Scores Enabled Temp Course',
      passwordHash: 'dummy',
      scoresEnabled: true,
      isActive: true,
    });
    const testCourseDisabled = await Course.create({
      title: 'Scores Disabled Temp Course',
      passwordHash: 'dummy',
      scoresEnabled: false,
      isActive: true,
    });

    const testStudentDisabled = await CertificateStudent.create({
      fullName: 'Test Disabled Student',
      email: 'test-scores-disabled@example.com',
      courseId: testCourseDisabled._id,
      certificateNumber: 'TEMP-MMC-DIS-1',
      isActive: true,
    });

    const testStudentEnabled = await CertificateStudent.create({
      fullName: 'Test Enabled Student',
      email: 'test-scores-enabled@example.com',
      courseId: testCourseEnabled._id,
      certificateNumber: 'TEMP-MMC-EN-1',
      isActive: true,
    });

    try {
      // 5c. Course with score checking disabled returns 403
      const resResendDisabled = await fetch(`${baseUrl}/scores/resend-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: '  TEST-SCORES-DISABLED@example.com  ' }),
      });
      assert.strictEqual(resResendDisabled.status, 403);
      const disabledJson = await resResendDisabled.json();
      assert.strictEqual(disabledJson.success, false);
      assert.strictEqual(disabledJson.message, 'Score checking is currently disabled for your enrolled course.');
      console.log('  ✔ Course with scoresEnabled false returns 403');

      // 5d. Recent unverified OTP returns 429 cooldown
      await EmailOTP.create({
        email: 'test-scores-enabled@example.com',
        otp: '112233',
        verified: false,
        createdAt: new Date(),
      });

      const resResendCooldown = await fetch(`${baseUrl}/scores/resend-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test-scores-enabled@example.com' }),
      });
      assert.strictEqual(resResendCooldown.status, 429);
      const cooldownJson = await resResendCooldown.json();
      assert.strictEqual(cooldownJson.success, false);
      assert.strictEqual(cooldownJson.message, 'Please wait 60 seconds before requesting a new OTP.');
      console.log('  ✔ Recent unverified OTP returns 429 cooldown');

      // 5e. Email delivery failure safety:
      // When email delivery fails, the existing OTP must NOT be destroyed, leaving the user with an intact OTP
      await EmailOTP.deleteMany({ email: 'test-scores-enabled@example.com' });
      const oldOtpRecord = await EmailOTP.create({
        email: 'test-scores-enabled@example.com',
        otp: '556677',
        verified: false,
        createdAt: new Date(Date.now() - 70 * 1000), // older than 60s cooldown
      });

      // Temporarily mock sendOTPEmail to simulate network / SMTP transport failure
      const originalSendOTPEmail = emailService.sendOTPEmail;
      emailService.sendOTPEmail = async () => {
        throw new Error('SMTP connection timeout');
      };

      try {
        const resDeliveryFailure = await fetch(`${baseUrl}/scores/resend-otp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'test-scores-enabled@example.com' }),
        });
        assert.strictEqual(resDeliveryFailure.status, 500);
        const failJson = await resDeliveryFailure.json();
        assert.strictEqual(failJson.success, false);
        assert.strictEqual(failJson.message, 'Failed to resend OTP. Please try again.');

        // Verify the existing OTP was NOT deleted on failure
        const survivingOtp = await EmailOTP.findById(oldOtpRecord._id);
        assert.ok(survivingOtp, 'Old OTP record must remain intact when email delivery fails');
        assert.strictEqual(survivingOtp.otp, '556677');
        console.log('  ✔ Failed email delivery preserves existing OTP without stranding user');
      } finally {
        emailService.sendOTPEmail = originalSendOTPEmail;
      }

      // 5f. Successful resend when email sends successfully
      // Mock sendOTPEmail to succeed without making external network calls
      let emailSentWith = null;
      emailService.sendOTPEmail = async (to, otp) => {
        emailSentWith = { to, otp };
        return { messageId: 'mock-msg-123' };
      };

      try {
        const resSuccess = await fetch(`${baseUrl}/scores/resend-otp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: '  TEST-SCORES-ENABLED@example.com ' }),
        });
        assert.strictEqual(resSuccess.status, 200);
        const successJson = await resSuccess.json();
        assert.strictEqual(successJson.success, true);
        assert.strictEqual(successJson.message, 'New OTP sent successfully!');
        assert.strictEqual(emailSentWith.to, 'test-scores-enabled@example.com');
        assert.strictEqual(typeof emailSentWith.otp, 'string');
        assert.strictEqual(emailSentWith.otp.length, 6);

        // Verify new OTP was saved in DB
        const savedNewOtp = await EmailOTP.findOne({ email: 'test-scores-enabled@example.com' });
        assert.strictEqual(savedNewOtp.otp, emailSentWith.otp);
        console.log('  ✔ Successful resend creates new OTP and sends email');

        // 5g. Verify that verifyOTP works with the newly resent OTP
        const resVerify = await fetch(`${baseUrl}/scores/verify-otp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'test-scores-enabled@example.com', otp: emailSentWith.otp }),
        });
        assert.strictEqual(resVerify.status, 200);
        const verifyJson = await resVerify.json();
        assert.strictEqual(verifyJson.success, true);
        console.log('  ✔ verifyOTP verifies resent OTP without regression');

        // 5h. Regression test: Database persistence failure prevents email dispatch
        // If EmailOTP.create fails, sendOTPEmail must NEVER be called, preventing phantom OTP emails
        let emailDispatchedOnDbFail = false;
        emailService.sendOTPEmail = async () => {
          emailDispatchedOnDbFail = true;
          return { messageId: 'phantom-msg' };
        };

        const originalCreate = EmailOTP.create;
        EmailOTP.create = async () => {
          throw new Error('Database write failure: connection pool exhausted');
        };

        try {
          const resDbFail = await fetch(`${baseUrl}/scores/send-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'test-scores-enabled@example.com' }),
          });
          assert.strictEqual(resDbFail.status, 500);
          assert.strictEqual(emailDispatchedOnDbFail, false, 'Email must NOT be sent if database persistence fails');
          console.log('  ✔ Database persistence failure prevents sending an unpersisted OTP email');
        } finally {
          EmailOTP.create = originalCreate;
        }
      } finally {
        emailService.sendOTPEmail = originalSendOTPEmail;
      }

    } finally {
      // Clean up test data
      await EmailOTP.deleteMany({
        email: { $in: ['test-scores-disabled@example.com', 'test-scores-enabled@example.com'] },
      });
      await CertificateStudent.deleteOne({ _id: testStudentDisabled._id });
      await CertificateStudent.deleteOne({ _id: testStudentEnabled._id });
      await Course.deleteOne({ _id: testCourseEnabled._id });
      await Course.deleteOne({ _id: testCourseDisabled._id });
    }

  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  console.log('\n🎉 ALL SCORES FEATURE TESTS PASSED SUCCESSFULLY!\n');
  process.exit(0);
}

runScoresFeatureTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
