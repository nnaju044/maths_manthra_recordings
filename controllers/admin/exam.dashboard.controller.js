/**
 * controllers/admin/exam.dashboard.controller.js
 * Admin metrics and statistics dashboard for Examinations.
 */
const Examination = require('../../models/Examination');
const QuestionBank = require('../../models/QuestionBank');
const ExamAttempt = require('../../models/ExamAttempt');
const ExamResult = require('../../models/ExamResult');
const ExamCertificate = require('../../models/ExamCertificate');

exports.getDashboard = async (req, res, next) => {
  try {
    const [
      totalExams,
      publishedExams,
      totalQuestions,
      totalAttempts,
      passedCount,
      failedCount,
      pendingEvaluationCount,
      totalCertificatesIssued,
      recentExams,
      recentAttempts,
    ] = await Promise.all([
      Examination.countDocuments({ status: { $ne: 'archived' } }),
      Examination.countDocuments({ status: 'published' }),
      QuestionBank.countDocuments({ status: 'active' }),
      ExamAttempt.countDocuments(),
      ExamResult.countDocuments({ isPassed: true }),
      ExamResult.countDocuments({ isPassed: false, resultStatus: 'finalized' }),
      ExamResult.countDocuments({ resultStatus: 'pending_evaluation' }),
      ExamCertificate.countDocuments({ status: 'valid' }),
      Examination.find({ status: { $ne: 'archived' } })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('courseId', 'title slug'),
      ExamAttempt.find()
        .sort({ createdAt: -1 })
        .limit(8)
        .populate('examinationId', 'title')
        .populate('studentId', 'fullName email studentId'),
    ]);

    res.render('admin/examinations/dashboard', {
      title: 'Examinations Dashboard — Maths Manthra',
      layout: 'layouts/admin',
      currentPage: 'examinations-dashboard',
      stats: {
        totalExams,
        publishedExams,
        totalQuestions,
        totalAttempts,
        passedCount,
        failedCount,
        pendingEvaluationCount,
        totalCertificatesIssued,
      },
      recentExams,
      recentAttempts,
    });
  } catch (err) {
    next(err);
  }
};

