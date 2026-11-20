/**
 * utils/scoring.js
 * Centralized marking engine and scoring rules for all six question types:
 * 1. single_choice (MCQ): exact match of optionId -> marks, or negativeMarks if wrong
 * 2. multiple_choice: exact-set matching, no partial credit by default
 * 3. true_false: exact boolean/option match
 * 4. fill_blank: whitespace/punctuation normalized text comparison with accepted variants
 * 5. short_answer: manual evaluation (pending)
 * 6. descriptive: manual evaluation (pending)
 */

/**
 * Normalizes text for fill_blank evaluation:
 * - Trims leading/trailing whitespace
 * - Collapses consecutive spaces
 * - Lowercases unless caseSensitive is true
 * - Optionally removes trailing punctuation (. or ?)
 */
function normalizeAnswerText(text, caseSensitive = false) {
  if (text === null || text === undefined) return '';
  let clean = String(text).trim().replace(/\s+/g, ' ');
  if (!caseSensitive) {
    clean = clean.toLowerCase();
  }
  return clean;
}

/**
 * Evaluates a student response against a question's private answer keys.
 * 
 * @param {Object} question - The snapshot question object containing privateAnswerKeys, marks, negativeMarks
 * @param {any} studentAnswer - The answer submitted by the student
 * @returns {Object} { evaluationStatus, isCorrect, awardedMarks }
 */
function evaluateResponse(question, studentAnswer) {
  const { questionType, marks = 1, negativeMarks = 0, privateAnswerKeys = {} } = question;
  const { correctAnswers = [], acceptedAnswers = [], caseSensitive = false } = privateAnswerKeys;

  // Question Types requiring Manual Evaluation (whether answered or not, as subjective questions require teacher review)
  if (questionType === 'short_answer' || questionType === 'descriptive') {
    const hasAnswer = !(
      studentAnswer === null ||
      studentAnswer === undefined ||
      (typeof studentAnswer === 'string' && studentAnswer.trim() === '') ||
      (Array.isArray(studentAnswer) && studentAnswer.length === 0)
    );
    return {
      evaluationStatus: hasAnswer ? 'pending_manual' : 'unanswered',
      isCorrect: hasAnswer ? null : false,
      awardedMarks: 0,
    };
  }

  // If student did not answer objective question
  if (
    studentAnswer === null ||
    studentAnswer === undefined ||
    (typeof studentAnswer === 'string' && studentAnswer.trim() === '') ||
    (Array.isArray(studentAnswer) && studentAnswer.length === 0)
  ) {
    return {
      evaluationStatus: 'unanswered',
      isCorrect: false,
      awardedMarks: 0,
    };
  }

  // Type 1: Single Choice (MCQ)
  if (questionType === 'single_choice') {
    const expected = (correctAnswers[0] || '').trim();
    const actual = String(studentAnswer).trim();
    const isCorrect = expected && actual === expected;
    return {
      evaluationStatus: 'auto_graded',
      isCorrect,
      awardedMarks: isCorrect ? marks : -Math.abs(negativeMarks),
    };
  }

  // Type 2: Multiple Choice (Exact-set match)
  if (questionType === 'multiple_choice') {
    if (!Array.isArray(studentAnswer)) {
      studentAnswer = [studentAnswer];
    }
    const actualSet = new Set(studentAnswer.map((s) => String(s).trim()));
    const expectedSet = new Set(correctAnswers.map((s) => String(s).trim()));

    let isCorrect = actualSet.size === expectedSet.size;
    if (isCorrect) {
      for (const item of expectedSet) {
        if (!actualSet.has(item)) {
          isCorrect = false;
          break;
        }
      }
    }

    return {
      evaluationStatus: 'auto_graded',
      isCorrect,
      awardedMarks: isCorrect ? marks : -Math.abs(negativeMarks),
    };
  }

  // Type 3: True / False
  if (questionType === 'true_false') {
    const expected = normalizeAnswerText(correctAnswers[0] || '', false);
    const actual = normalizeAnswerText(studentAnswer, false);
    const isCorrect = expected && actual === expected;
    return {
      evaluationStatus: 'auto_graded',
      isCorrect,
      awardedMarks: isCorrect ? marks : -Math.abs(negativeMarks),
    };
  }

  // Type 4: Fill in the Blank
  if (questionType === 'fill_blank') {
    const normalizedActual = normalizeAnswerText(studentAnswer, caseSensitive);
    const variants = (acceptedAnswers.length > 0 ? acceptedAnswers : correctAnswers).map((ans) =>
      normalizeAnswerText(ans, caseSensitive)
    );

    const isCorrect = variants.some((variant) => variant === normalizedActual);
    return {
      evaluationStatus: 'auto_graded',
      isCorrect,
      awardedMarks: isCorrect ? marks : -Math.abs(negativeMarks),
    };
  }

  return {
    evaluationStatus: 'auto_graded',
    isCorrect: false,
    awardedMarks: 0,
  };
}

module.exports = {
  normalizeAnswerText,
  evaluateResponse,
};

