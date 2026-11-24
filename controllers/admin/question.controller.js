/**
 * controllers/admin/question.controller.js
 * Admin controller for Reusable Question Bank:
 * - List questions with category, difficulty, type, and search filters
 * - Create questions across all 6 question types
 * - Support image upload and Cloudinary synchronization
 * - Edit existing questions
 * - Archive/Restore questions
 * - Excel template download and bulk import with validation & preview
 */
const QuestionBank = require('../../models/QuestionBank');
const xlsx = require('xlsx');

/**
 * Safe redirect helper for serverless / Vercel environments.
 * Awaits session persistence before responding with HTTP 303 See Other
 * to force the client to make a GET request and prevent redirect loops.
 * Propagates session persistence errors to express error handler.
 */
function safeRedirect(req, res, targetUrl, next) {
  if (res.headersSent) {
    return;
  }
  const errorHandler = typeof next === 'function' ? next : (typeof req.next === 'function' ? req.next : null);
  if (req.session && typeof req.session.save === 'function') {
    return req.session.save((err) => {
      if (err) {
        console.error('Session save error during safeRedirect:', err.message);
        if (errorHandler) {
          return errorHandler(err);
        }
        if (!res.headersSent) {
          return res.status(500).send('Session persistence failure');
        }
        return;
      }
      if (!res.headersSent) {
        return res.redirect(303, targetUrl);
      }
    });
  }
  return res.redirect(303, targetUrl);
}

/**
 * GET /admin/questions
 * List all questions with filtering and pagination.
 */
exports.index = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 15);
    const skip = (page - 1) * limit;

    const { category, type, difficulty, status = 'active', search } = req.query;

    const filter = {};
    if (status !== 'all') {
      filter.status = status;
    }
    if (category) {
      filter.category = category.trim();
    }
    if (type) {
      filter.questionType = type.trim();
    }
    if (difficulty) {
      filter.difficulty = difficulty.trim();
    }
    if (search) {
      filter.$text = { $search: search.trim() };
    }

    const [questions, totalCount, categories] = await Promise.all([
      QuestionBank.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('createdBy', 'name email'),
      QuestionBank.countDocuments(filter),
      QuestionBank.distinct('category'),
    ]);

    const totalPages = Math.ceil(totalCount / limit) || 1;

    res.render('admin/questions/index', {
      title: 'Question Bank — Maths Manthra',
      layout: 'layouts/admin',
      currentPage: 'examinations-questions',
      questions,
      categories,
      filter: { category, type, difficulty, status, search },
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
 * GET /admin/questions/create
 * Form to create a new question.
 */
exports.create = async (req, res, next) => {
  try {
    const categories = await QuestionBank.distinct('category');
    res.render('admin/questions/create', {
      title: 'Add Question — Question Bank',
      layout: 'layouts/admin',
      currentPage: 'examinations-questions',
      categories,
      question: null,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /admin/questions
 * Save new question to Question Bank.
 */
exports.store = async (req, res, next) => {
  try {
    const {
      questionText,
      questionType,
      category,
      topic,
      difficulty = 'medium',
      marks = 1,
      negativeMarks = 0,
      explanation = '',
      caseSensitive,
      // For Single & Multiple Choice
      optionTexts = [],
      optionIds = [],
      correctOptionIds = [],
      singleCorrectOption,
      // For True/False
      tfCorrect,
      // For Fill in Blank
      acceptedAnswersText = '',
      // For Manual Grading (Short Answer / Descriptive)
      markingGuideline = '',
    } = req.body;

    if (!questionText || !questionType || !category) {
      req.flash('error', 'Please fill in Question Text, Type, and Category.');
      return safeRedirect(req, res, '/admin/questions/create', next);
    }

    let parsedOptions = [];
    let correctAnswers = [];
    let acceptedAnswers = [];

    // Assemble Options & Correct Answers strictly based on questionType
    if (questionType === 'single_choice') {
      const texts = Array.isArray(optionTexts) ? optionTexts : [optionTexts];
      const ids = Array.isArray(optionIds) ? optionIds : [optionIds];

      parsedOptions = ids.map((id, index) => ({
        optionId: String(id || `opt_${index + 1}`).trim(),
        text: String(texts[index] || '').trim(),
      })).filter((opt) => opt.text !== '');

      if (!singleCorrectOption) {
        req.flash('error', 'Please designate the single correct answer option.');
        return safeRedirect(req, res, '/admin/questions/create', next);
      }
      correctAnswers = [String(singleCorrectOption).trim()];
    } else if (questionType === 'multiple_choice') {
      const texts = Array.isArray(optionTexts) ? optionTexts : [optionTexts];
      const ids = Array.isArray(optionIds) ? optionIds : [optionIds];

      parsedOptions = ids.map((id, index) => ({
        optionId: String(id || `opt_${index + 1}`).trim(),
        text: String(texts[index] || '').trim(),
      })).filter((opt) => opt.text !== '');

      const selected = Array.isArray(correctOptionIds) ? correctOptionIds : [correctOptionIds].filter(Boolean);
      correctAnswers = selected.map((s) => String(s).trim());

      if (correctAnswers.length === 0) {
        req.flash('error', 'Please select at least one correct option for Multiple Choice.');
        return safeRedirect(req, res, '/admin/questions/create', next);
      }
    } else if (questionType === 'true_false') {
      parsedOptions = [
        { optionId: 'true', text: 'True' },
        { optionId: 'false', text: 'False' },
      ];
      correctAnswers = [String(tfCorrect || 'true').toLowerCase()];
    } else if (questionType === 'fill_blank') {
      acceptedAnswers = String(acceptedAnswersText)
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);

      if (acceptedAnswers.length === 0) {
        req.flash('error', 'Please provide at least one accepted answer for Fill in the Blank.');
        return safeRedirect(req, res, '/admin/questions/create', next);
      }
      correctAnswers = [acceptedAnswers[0]];
    } else if (questionType === 'short_answer' || questionType === 'descriptive') {
      // Manual grading questions have no MCQ options or automated answer keys
      parsedOptions = [];
      correctAnswers = [];
      acceptedAnswers = [];
    }

    // Handle optional uploaded image
    let image = null;
    let imagePublicId = null;
    if (req.file) {
      image = req.file.path || req.file.secure_url || req.file.url;
      imagePublicId = req.file.filename || req.file.public_id;
    }

    await QuestionBank.create({
      questionText: questionText.trim(),
      questionType,
      category: category.trim(),
      topic: (topic || '').trim(),
      difficulty,
      marks: Math.max(0.25, parseFloat(marks) || 1),
      negativeMarks: (questionType === 'short_answer' || questionType === 'descriptive')
        ? 0
        : Math.max(0, parseFloat(negativeMarks) || 0),
      explanation: (explanation || '').trim(),
      markingGuideline: (markingGuideline || '').trim(),
      caseSensitive: questionType === 'fill_blank' && (caseSensitive === 'true' || caseSensitive === true),
      options: parsedOptions,
      correctAnswers,
      acceptedAnswers,
      image,
      imagePublicId,
      createdBy: req.user?._id || null,
    });

    req.flash('success', 'Question added to Question Bank successfully.');
    return safeRedirect(req, res, '/admin/questions', next);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /admin/questions/:id/edit
 * Form to edit an existing question.
 */
exports.edit = async (req, res, next) => {
  try {
    const question = await QuestionBank.findById(req.params.id);
    if (!question) {
      req.flash('error', 'Question not found.');
      return safeRedirect(req, res, '/admin/questions', next);
    }

    const categories = await QuestionBank.distinct('category');

    res.render('admin/questions/edit', {
      title: 'Edit Question — Question Bank',
      layout: 'layouts/admin',
      currentPage: 'examinations-questions',
      categories,
      question,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /admin/questions/:id
 * Update question details in Question Bank.
 */
exports.update = async (req, res, next) => {
  try {
    const question = await QuestionBank.findById(req.params.id);
    if (!question) {
      req.flash('error', 'Question not found.');
      return safeRedirect(req, res, '/admin/questions', next);
    }

    const {
      questionText,
      questionType,
      category,
      topic,
      difficulty,
      marks,
      negativeMarks,
      explanation,
      caseSensitive,
      status,
      optionTexts = [],
      optionIds = [],
      correctOptionIds = [],
      singleCorrectOption,
      tfCorrect,
      acceptedAnswersText = '',
      markingGuideline = '',
    } = req.body;

    question.questionText = (questionText || question.questionText).trim();
    question.category = (category || question.category).trim();
    question.topic = (topic !== undefined ? topic : question.topic).trim();
    question.difficulty = difficulty || question.difficulty;
    question.marks = Math.max(0.25, parseFloat(marks) || question.marks);
    question.explanation = (explanation !== undefined ? explanation : question.explanation).trim();
    question.markingGuideline = (markingGuideline !== undefined ? markingGuideline : question.markingGuideline).trim();
    if (status) question.status = status;

    // Update options & correct answers if questionType is retained or modified
    const currentType = questionType || question.questionType;
    question.questionType = currentType;

    // Update negative marks: for manual grading types, negative marks are not applicable (0)
    if (currentType === 'short_answer' || currentType === 'descriptive') {
      question.negativeMarks = 0;
      question.caseSensitive = false;
      question.options = [];
      question.correctAnswers = [];
      question.acceptedAnswers = [];
    } else {
      question.negativeMarks = Math.max(0, parseFloat(negativeMarks) || 0);
      question.caseSensitive = currentType === 'fill_blank' && (caseSensitive === 'true' || caseSensitive === true);
    }

    if (currentType === 'single_choice') {
      const texts = Array.isArray(optionTexts) ? optionTexts : [optionTexts];
      const ids = Array.isArray(optionIds) ? optionIds : [optionIds];
      question.options = ids.map((id, index) => ({
        optionId: String(id || `opt_${index + 1}`).trim(),
        text: String(texts[index] || '').trim(),
      })).filter((opt) => opt.text !== '');

      if (singleCorrectOption) {
        question.correctAnswers = [String(singleCorrectOption).trim()];
      }
      question.acceptedAnswers = [];
    } else if (currentType === 'multiple_choice') {
      const texts = Array.isArray(optionTexts) ? optionTexts : [optionTexts];
      const ids = Array.isArray(optionIds) ? optionIds : [optionIds];
      question.options = ids.map((id, index) => ({
        optionId: String(id || `opt_${index + 1}`).trim(),
        text: String(texts[index] || '').trim(),
      })).filter((opt) => opt.text !== '');

      const selected = Array.isArray(correctOptionIds) ? correctOptionIds : [correctOptionIds].filter(Boolean);
      if (selected.length > 0) {
        question.correctAnswers = selected.map((s) => String(s).trim());
      }
      question.acceptedAnswers = [];
    } else if (currentType === 'true_false') {
      question.options = [
        { optionId: 'true', text: 'True' },
        { optionId: 'false', text: 'False' },
      ];
      if (tfCorrect) {
        question.correctAnswers = [String(tfCorrect).toLowerCase()];
      }
      question.acceptedAnswers = [];
    } else if (currentType === 'fill_blank') {
      question.options = [];
      if (acceptedAnswersText) {
        question.acceptedAnswers = String(acceptedAnswersText)
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
        question.correctAnswers = [question.acceptedAnswers[0] || ''];
      }
    }

    if (req.file) {
      question.image = req.file.path || req.file.secure_url || req.file.url;
      question.imagePublicId = req.file.filename || req.file.public_id;
    }

    question.updatedBy = req.user?._id || null;
    await question.save();

    req.flash('success', 'Question updated successfully.');
    return safeRedirect(req, res, '/admin/questions', next);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /admin/questions/:id/toggle-status
 * Toggle active / archived state.
 */
exports.toggleStatus = async (req, res, next) => {
  try {
    const question = await QuestionBank.findById(req.params.id);
    if (!question) {
      req.flash('error', 'Question not found.');
      return safeRedirect(req, res, '/admin/questions', next);
    }
    question.status = question.status === 'active' ? 'archived' : 'active';
    await question.save();
    req.flash('success', `Question ${question.status === 'active' ? 'restored' : 'archived'} successfully.`);
    return safeRedirect(req, res, '/admin/questions', next);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /admin/questions/template
 * Download Excel template for bulk question imports.
 */
exports.downloadTemplate = (req, res) => {
  const sampleData = [
    {
      'Question Text': 'What is the sum of interior angles of a triangle?',
      'Question Type': 'single_choice',
      'Category': 'Mathematics',
      'Topic': 'Geometry',
      'Difficulty': 'easy',
      'Marks': 2,
      'Negative Marks': 0,
      'Option A': '90 degrees',
      'Option B': '180 degrees',
      'Option C': '270 degrees',
      'Option D': '360 degrees',
      'Correct Answer': 'B',
      'Explanation': 'The interior angles of any Euclidean triangle always sum to 180 degrees.',
    },
    {
      'Question Text': 'Select all prime numbers below 10.',
      'Question Type': 'multiple_choice',
      'Category': 'Mathematics',
      'Topic': 'Number Systems',
      'Difficulty': 'medium',
      'Marks': 3,
      'Negative Marks': 1,
      'Option A': '2',
      'Option B': '3',
      'Option C': '4',
      'Option D': '5',
      'Correct Answer': 'A,B,D',
      'Explanation': '2, 3, and 5 are prime numbers. 4 is composite.',
    },
    {
      'Question Text': 'Zero is neither a positive nor a negative integer.',
      'Question Type': 'true_false',
      'Category': 'Mathematics',
      'Topic': 'Number Systems',
      'Difficulty': 'easy',
      'Marks': 1,
      'Negative Marks': 0,
      'Option A': '',
      'Option B': '',
      'Option C': '',
      'Option D': '',
      'Correct Answer': 'True',
      'Explanation': '0 is neutral in sign.',
    },
    {
      'Question Text': 'The value of Pi rounded to 2 decimal places is ____.',
      'Question Type': 'fill_blank',
      'Category': 'Mathematics',
      'Topic': 'Constants',
      'Difficulty': 'easy',
      'Marks': 2,
      'Negative Marks': 0,
      'Option A': '',
      'Option B': '',
      'Option C': '',
      'Option D': '',
      'Correct Answer': '3.14 | 3.1416 | 22/7',
      'Explanation': 'Common decimal approximations.',
    },
  ];

  const worksheet = xlsx.utils.json_to_sheet(sampleData);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Questions_Template');

  const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="maths_manthra_questions_template.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  return res.send(buffer);
};

/**
 * GET /admin/questions/import
 * Render upload page for bulk question ingestion.
 */
exports.getImport = (req, res) => {
  res.render('admin/questions/import', {
    title: 'Import Questions via Excel — Question Bank',
    layout: 'layouts/admin',
    currentPage: 'examinations-questions',
  });
};

/**
 * POST /admin/questions/import
 * Ingest and validate Excel questions.
 */
exports.postImport = async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer) {
      req.flash('error', 'Please upload a valid .xlsx or .xls Excel file.');
      return res.redirect('/admin/questions/import');
    }

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      req.flash('error', 'The uploaded Excel file has no worksheets.');
      return res.redirect('/admin/questions/import');
    }

    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
    if (!rows || rows.length === 0) {
      req.flash('error', 'No rows found in the uploaded spreadsheet.');
      return res.redirect('/admin/questions/import');
    }

    const questionsToInsert = [];
    const errors = [];

    rows.forEach((row, idx) => {
      const rowNum = idx + 2;
      const text = String(row['Question Text'] || '').trim();
      let type = String(row['Question Type'] || '').trim().toLowerCase();
      const category = String(row['Category'] || '').trim();
      const topic = String(row['Topic'] || '').trim();
      let difficulty = String(row['Difficulty'] || 'medium').trim().toLowerCase();
      if (!['easy', 'medium', 'hard'].includes(difficulty)) difficulty = 'medium';

      const marks = Math.max(0.25, parseFloat(row['Marks']) || 1);
      const negativeMarks = Math.max(0, parseFloat(row['Negative Marks']) || 0);
      const rawCorrect = String(row['Correct Answer'] || '').trim();
      const explanation = String(row['Explanation'] || '').trim();

      if (!text || !category) {
        errors.push(`Row ${rowNum}: Missing Question Text or Category.`);
        return;
      }

      const validTypes = ['single_choice', 'multiple_choice', 'true_false', 'fill_blank', 'short_answer', 'descriptive'];
      if (!validTypes.includes(type)) {
        errors.push(`Row ${rowNum}: Invalid Question Type "${type}". Must be one of: ${validTypes.join(', ')}.`);
        return;
      }

      let options = [];
      let correctAnswers = [];
      let acceptedAnswers = [];

      if (type === 'single_choice' || type === 'multiple_choice') {
        const optionKeys = ['Option A', 'Option B', 'Option C', 'Option D', 'Option E', 'Option F'];
        const letterMap = ['a', 'b', 'c', 'd', 'e', 'f'];

        optionKeys.forEach((key, kIdx) => {
          const optVal = String(row[key] || '').trim();
          if (optVal) {
            options.push({
              optionId: letterMap[kIdx],
              text: optVal,
            });
          }
        });

        if (options.length < 2) {
          errors.push(`Row ${rowNum}: Multiple choice questions require at least two options.`);
          return;
        }

        if (type === 'single_choice') {
          const matchLetter = rawCorrect.toLowerCase().trim();
          const targetOpt = options.find((o) => o.optionId === matchLetter);
          if (!targetOpt) {
            errors.push(`Row ${rowNum}: Correct Answer "${rawCorrect}" does not match any Option (e.g. A, B, C, D).`);
            return;
          }
          correctAnswers = [targetOpt.optionId];
        } else {
          // multiple choice
          const letters = rawCorrect.toLowerCase().split(/[,|;]/).map((s) => s.trim()).filter(Boolean);
          correctAnswers = options.filter((o) => letters.includes(o.optionId)).map((o) => o.optionId);
          if (correctAnswers.length === 0) {
            errors.push(`Row ${rowNum}: No valid matching option letters found in "${rawCorrect}".`);
            return;
          }
        }
      } else if (type === 'true_false') {
        options = [
          { optionId: 'true', text: 'True' },
          { optionId: 'false', text: 'False' },
        ];
        const tf = rawCorrect.toLowerCase().trim();
        correctAnswers = [tf.startsWith('t') || tf === '1' ? 'true' : 'false'];
      } else if (type === 'fill_blank') {
        acceptedAnswers = rawCorrect.split('|').map((s) => s.trim()).filter(Boolean);
        correctAnswers = [acceptedAnswers[0] || rawCorrect];
      }

      questionsToInsert.push({
        questionText: text,
        questionType: type,
        category,
        topic,
        difficulty,
        marks,
        negativeMarks,
        options,
        correctAnswers,
        acceptedAnswers,
        explanation,
        status: 'active',
        createdBy: req.user?._id || null,
      });
    });

    if (questionsToInsert.length === 0) {
      req.flash('error', `Import failed with errors: ${errors.slice(0, 5).join(' ')}`);
      return safeRedirect(req, res, '/admin/questions/import', next);
    }

    await QuestionBank.insertMany(questionsToInsert);

    let msg = `Successfully imported ${questionsToInsert.length} questions.`;
    if (errors.length > 0) {
      msg += ` Skipped ${errors.length} invalid rows.`;
    }
    req.flash('success', msg);
    return safeRedirect(req, res, '/admin/questions', next);
  } catch (err) {
    next(err);
  }
};

