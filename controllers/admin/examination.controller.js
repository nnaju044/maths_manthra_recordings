/**
 * controllers/admin/examination.controller.js
 * Admin controller for Examination Management:
 * - List examinations with status filtering and stats
 * - Create new examinations with guided wizard options
 * - Support both Scheduled (date window) and Anytime modes
 * - Support Manual and Random Category Question Selection
 * - Edit draft or locked examinations (with versioning)
 * - Toggle status (Published, Closed, Archived)
 * - Duplicate / Clone examination configurations
 */
const Examination = require('../../models/Examination');
const QuestionBank = require('../../models/QuestionBank');
const Course = require('../../models/Course');
const ExamAttempt = require('../../models/ExamAttempt');

/**
 * GET /admin/examinations
 * List all examinations with statistics.
 */
exports.index = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 15);
    const skip = (page - 1) * limit;

    const { status, category, courseId, search } = req.query;

    const filter = {};
    if (status && status !== 'all') {
      filter.status = status;
    }
    if (category) {
      filter.category = category.trim();
    }
    if (courseId) {
      filter.courseId = courseId;
    }
    if (search) {
      filter.$text = { $search: search.trim() };
    }

    const [examinations, totalCount, courses, categories] = await Promise.all([
      Examination.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('courseId', 'title slug')
        .populate('createdBy', 'name email'),
      Examination.countDocuments(filter),
      Course.find({ isActive: true }).select('title slug').sort({ title: 1 }),
      Examination.distinct('category'),
    ]);

    const totalPages = Math.ceil(totalCount / limit) || 1;

    res.render('admin/examinations/index', {
      title: 'Examinations Management — Maths Manthra',
      layout: 'layouts/admin',
      currentPage: 'examinations-manage',
      examinations,
      courses,
      categories,
      filter: { status, category, courseId, search },
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /admin/examinations/create
 * Render step-by-step examination creation wizard.
 */
exports.create = async (req, res, next) => {
  try {
    const [courses, categories, availableQuestions] = await Promise.all([
      Course.find({ isActive: true }).select('title slug').sort({ title: 1 }),
      QuestionBank.distinct('category'),
      QuestionBank.find({ status: 'active' }).select('questionText questionType category topic marks difficulty'),
    ]);

    res.render('admin/examinations/create', {
      title: 'Create Examination — Maths Manthra',
      layout: 'layouts/admin',
      currentPage: 'examinations-manage',
      courses,
      categories,
      availableQuestions,
      examination: null,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /admin/examinations
 * Store newly configured examination.
 */
exports.store = async (req, res, next) => {
  try {
    const {
      title,
      description = '',
      instructions = '',
      category,
      courseId,
      availabilityMode = 'anytime',
      startAt,
      endAt,
      durationMinutes = 60,
      totalMarks = 100,
      passingMarks = 40,
      maxAttempts = 3,
      negativeMarking,
      randomizeQuestions,
      randomizeOptions,
      displayMode = 'one_at_a_time',
      showResultsImmediately,
      showCorrectAnswersAfterEvaluation,
      questionSelectionMode = 'manual',
      selectedQuestions = [],
      status = 'draft',
      certificateEnabled,
    } = req.body;

    if (!title || !category) {
      req.flash('error', 'Please provide Examination Title and Category.');
      return res.redirect('/admin/examinations/create');
    }

    let parsedStartAt = null;
    let parsedEndAt = null;
    if (availabilityMode === 'scheduled') {
      if (!startAt || !endAt) {
        req.flash('error', 'Scheduled examinations require both Start Date/Time and End Date/Time.');
        return res.redirect('/admin/examinations/create');
      }
      parsedStartAt = new Date(startAt);
      parsedEndAt = new Date(endAt);
      if (parsedEndAt <= parsedStartAt) {
        req.flash('error', 'Scheduled End Date must be after Start Date.');
        return res.redirect('/admin/examinations/create');
      }
    }

    const questionsList = Array.isArray(selectedQuestions)
      ? selectedQuestions
      : [selectedQuestions].filter(Boolean);

    let thumbnail = null;
    if (req.file) {
      thumbnail = req.file.path || req.file.secure_url || req.file.url;
    }

    const exam = await Examination.create({
      title: title.trim(),
      description: description.trim(),
      instructions: instructions.trim(),
      category: category.trim(),
      courseId: courseId || null,
      thumbnail,
      status,
      availabilityMode,
      startAt: parsedStartAt,
      endAt: parsedEndAt,
      durationMinutes: Math.max(1, parseInt(durationMinutes) || 60),
      totalMarks: Math.max(1, parseFloat(totalMarks) || 100),
      passingMarks: Math.max(0, parseFloat(passingMarks) || 40),
      maxAttempts: Math.max(1, parseInt(maxAttempts) || 3),
      negativeMarking: negativeMarking === 'true' || negativeMarking === true,
      randomizeQuestions: randomizeQuestions === 'true' || randomizeQuestions === true,
      randomizeOptions: randomizeOptions === 'true' || randomizeOptions === true,
      displayMode,
      showResultsImmediately: showResultsImmediately === 'true' || showResultsImmediately === true,
      showCorrectAnswersAfterEvaluation: showCorrectAnswersAfterEvaluation === 'true' || showCorrectAnswersAfterEvaluation === true,
      questionSelectionMode,
      selectedQuestions: questionsList,
      certificateEnabled: certificateEnabled === 'true' || certificateEnabled === true,
      createdBy: req.user?._id || null,
    });

    req.flash('success', `Examination "${exam.title}" created successfully.`);
    res.redirect('/admin/examinations');
  } catch (err) {
    next(err);
  }
};

/**
 * GET /admin/examinations/:id/edit
 * Render editor form with versioning guard.
 */
exports.edit = async (req, res, next) => {
  try {
    const exam = await Examination.findById(req.params.id)
      .populate('courseId', 'title slug')
      .populate('selectedQuestions');

    if (!exam) {
      req.flash('error', 'Examination not found.');
      return res.redirect('/admin/examinations');
    }

    // Check if any student attempts have started
    const hasAttempts = await ExamAttempt.exists({ examinationId: exam._id });
    if (hasAttempts && !exam.isLocked) {
      exam.isLocked = true;
      await exam.save();
    }

    const [courses, categories, availableQuestions] = await Promise.all([
      Course.find({ isActive: true }).select('title slug').sort({ title: 1 }),
      QuestionBank.distinct('category'),
      QuestionBank.find({ status: 'active' }).select('questionText questionType category topic marks difficulty'),
    ]);

    res.render('admin/examinations/edit', {
      title: `Edit Exam: ${exam.title}`,
      layout: 'layouts/admin',
      currentPage: 'examinations-manage',
      examination: exam,
      hasAttempts: Boolean(hasAttempts),
      courses,
      categories,
      availableQuestions,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /admin/examinations/:id
 * Update examination with controlled lock & versioning protection.
 */
exports.update = async (req, res, next) => {
  try {
    const exam = await Examination.findById(req.params.id);
    if (!exam) {
      req.flash('error', 'Examination not found.');
      return res.redirect('/admin/examinations');
    }

    const hasAttempts = await ExamAttempt.exists({ examinationId: exam._id });

    const {
      title,
      description,
      instructions,
      category,
      courseId,
      availabilityMode,
      startAt,
      endAt,
      durationMinutes,
      totalMarks,
      passingMarks,
      maxAttempts,
      negativeMarking,
      randomizeQuestions,
      randomizeOptions,
      displayMode,
      showResultsImmediately,
      showCorrectAnswersAfterEvaluation,
      questionSelectionMode,
      selectedQuestions = [],
      status,
      certificateEnabled,
    } = req.body;

    // Basic metadata can always be edited
    exam.title = (title || exam.title).trim();
    exam.description = (description !== undefined ? description : exam.description).trim();
    exam.instructions = (instructions !== undefined ? instructions : exam.instructions).trim();
    exam.category = (category || exam.category).trim();
    exam.courseId = courseId || null;
    if (status) exam.status = status;
    exam.certificateEnabled = certificateEnabled === 'true' || certificateEnabled === true;
    exam.showResultsImmediately = showResultsImmediately === 'true' || showResultsImmediately === true;
    exam.showCorrectAnswersAfterEvaluation = showCorrectAnswersAfterEvaluation === 'true' || showCorrectAnswersAfterEvaluation === true;

    // If NO attempts have started, allow editing structural questions, marks, and duration
    if (!hasAttempts) {
      exam.availabilityMode = availabilityMode || exam.availabilityMode;
      if (exam.availabilityMode === 'scheduled') {
        if (startAt) exam.startAt = new Date(startAt);
        if (endAt) exam.endAt = new Date(endAt);
      } else {
        exam.startAt = null;
        exam.endAt = null;
      }

      exam.durationMinutes = Math.max(1, parseInt(durationMinutes) || exam.durationMinutes);
      exam.totalMarks = Math.max(1, parseFloat(totalMarks) || exam.totalMarks);
      exam.passingMarks = Math.max(0, parseFloat(passingMarks) || exam.passingMarks);
      exam.maxAttempts = Math.max(1, parseInt(maxAttempts) || exam.maxAttempts);
      exam.negativeMarking = negativeMarking === 'true' || negativeMarking === true;
      exam.randomizeQuestions = randomizeQuestions === 'true' || randomizeQuestions === true;
      exam.randomizeOptions = randomizeOptions === 'true' || randomizeOptions === true;
      exam.displayMode = displayMode || exam.displayMode;
      exam.questionSelectionMode = questionSelectionMode || exam.questionSelectionMode;

      const questionsList = Array.isArray(selectedQuestions)
        ? selectedQuestions
        : [selectedQuestions].filter(Boolean);
      if (questionsList.length > 0) {
        exam.selectedQuestions = questionsList;
      }
    } else {
      // Locked: student attempts exist. Increment version if admin forced changes.
      exam.isLocked = true;
      exam.version += 1;
    }

    if (req.file) {
      exam.thumbnail = req.file.path || req.file.secure_url || req.file.url;
    }

    exam.updatedBy = req.user?._id || null;
    await exam.save();

    req.flash('success', `Examination "${exam.title}" updated successfully.`);
    res.redirect('/admin/examinations');
  } catch (err) {
    next(err);
  }
};

/**
 * POST /admin/examinations/:id/status
 * Quick status switcher (Draft, Published, Closed, Archived).
 */
exports.updateStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['draft', 'published', 'closed', 'archived'].includes(status)) {
      req.flash('error', 'Invalid examination status.');
      return res.redirect('/admin/examinations');
    }

    const exam = await Examination.findById(req.params.id);
    if (!exam) {
      req.flash('error', 'Examination not found.');
      return res.redirect('/admin/examinations');
    }

    // Validation before publishing
    if (status === 'published') {
      if (!exam.selectedQuestions || exam.selectedQuestions.length === 0) {
        req.flash('error', 'Cannot publish an examination without any selected questions.');
        return res.redirect('/admin/examinations');
      }
      if (exam.availabilityMode === 'scheduled' && (!exam.startAt || !exam.endAt)) {
        req.flash('error', 'Cannot publish scheduled examination without Start and End times.');
        return res.redirect('/admin/examinations');
      }
    }

    exam.status = status;
    exam.updatedBy = req.user?._id || null;
    await exam.save();

    req.flash('success', `Examination status updated to "${status}".`);
    res.redirect('/admin/examinations');
  } catch (err) {
    next(err);
  }
};

