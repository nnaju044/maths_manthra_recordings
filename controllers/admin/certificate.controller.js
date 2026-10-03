/**
 * controllers/admin/certificate.controller.js
 * Excel import and management for certificate students.
 */
const crypto = require('crypto');
const xlsx = require('xlsx');
const CertificateStudent = require('../../models/CertificateStudent');
const Course = require('../../models/Course');
const Counter = require('../../models/Counter');
const { paginate } = require('../../utils/pagination');

/**
 * Helper to extract value from row object matching candidate header names
 */
function getRowValue(row, candidates) {
  for (const candidate of candidates) {
    if (row[candidate] !== undefined && row[candidate] !== null && String(row[candidate]).trim() !== '') {
      return String(row[candidate]).trim();
    }
  }

  // Normalized key match (case-insensitive, remove non-alphanumeric)
  const rowKeys = Object.keys(row);
  for (const candidate of candidates) {
    const normCandidate = candidate.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const key of rowKeys) {
      const normKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normKey === normCandidate && row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
        return String(row[key]).trim();
      }
    }
  }
  return '';
}

/**
 * Generate an auto-increment sequential certificate number
 * Format: MMC-YYYY-SEQ (e.g. MMC-2026-20001)
 */
async function generateUniqueCertificateNumber() {
  const year = new Date().getFullYear();

  try {
    await Counter.updateOne(
      { year },
      { $setOnInsert: { year, lastNumber: 20000 } },
      { upsert: true }
    );
  } catch (err) {
    if (err.code !== 11000) throw err;
  }

  const counter = await Counter.findOneAndUpdate(
    { year },
    { $inc: { lastNumber: 1 } },
    { new: true, upsert: true }
  );

  return `MMC-${year}-${counter.lastNumber}`;
}

/**
 * Generate a unique sequential student ID
 * Format: MM-YYYY-XXXX (e.g. MM-2026-0028, MM-2026-0029, MM-2026-0030)
 */
async function generateUniqueStudentId() {
  const year = new Date().getFullYear();

  // For 2026, default base is 27 so the next new student starts at 0028.
  // For other years, default base is 0 so the first student starts at 0001.
  const defaultBase = year === 2026 ? 27 : 0;

  try {
    await Counter.updateOne(
      { year },
      { $setOnInsert: { year, lastNumber: 20000, lastStudentNumber: defaultBase } },
      { upsert: true }
    );
  } catch (err) {
    if (err.code !== 11000) throw err;
  }

  // Ensure lastStudentNumber is initialized on existing counter records
  const existingCounter = await Counter.findOne({ year }).lean();
  if (existingCounter && (existingCounter.lastStudentNumber === undefined || existingCounter.lastStudentNumber === null)) {
    const regex = new RegExp(`^MM-${year}-(\\d+)$`, 'i');
    const existingStudents = await CertificateStudent.find({ studentId: { $regex: regex } }, 'studentId').lean();
    let maxFound = defaultBase;
    for (const s of existingStudents) {
      const match = s.studentId && s.studentId.match(regex);
      if (match && match[1]) {
        const num = parseInt(match[1], 10);
        if (num > maxFound) maxFound = num;
      }
    }
    await Counter.updateOne({ year }, { $set: { lastStudentNumber: maxFound } });
  }

  let sid = '';
  let exists = true;
  while (exists) {
    const counter = await Counter.findOneAndUpdate(
      { year },
      { $inc: { lastStudentNumber: 1 } },
      { new: true, upsert: true }
    );

    const seqPadded = String(counter.lastStudentNumber).padStart(4, '0');
    sid = `MM-${year}-${seqPadded}`;
    exists = await CertificateStudent.exists({ studentId: sid });
  }

  return sid;
}

/**
 * Helper to extract nested progress fields from req.body
 */
function extractProgressFields(body) {
  const getWeeklyMark = (week, field) => {
    // 1. Check body.weeklyPerformance[week][field]
    if (body.weeklyPerformance && typeof body.weeklyPerformance === 'object' && body.weeklyPerformance[week]) {
      const v = body.weeklyPerformance[week][field];
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        const n = Number(v);
        return isNaN(n) ? 0 : Math.min(5, Math.max(0, n));
      }
    }
    // 2. Check body[week][field]
    if (body[week] && typeof body[week] === 'object' && body[week][field] !== undefined) {
      const v = body[week][field];
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        const n = Number(v);
        return isNaN(n) ? 0 : Math.min(5, Math.max(0, n));
      }
    }
    // 3. Check flat names e.g. week1_assignmentHomework or weeklyPerformance_week1_assignmentHomework
    const flat1 = body[`${week}_${field}`];
    if (flat1 !== undefined && flat1 !== null && String(flat1).trim() !== '') {
      const n = Number(flat1);
      return isNaN(n) ? 0 : Math.min(5, Math.max(0, n));
    }
    const flat2 = body[`weeklyPerformance_${week}_${field}`];
    if (flat2 !== undefined && flat2 !== null && String(flat2).trim() !== '') {
      const n = Number(flat2);
      return isNaN(n) ? 0 : Math.min(5, Math.max(0, n));
    }
    return 0;
  };

  const getNum = (val) => {
    if (val === undefined || val === null || String(val).trim() === '') return 0;
    const n = Number(val);
    return isNaN(n) ? 0 : Math.max(0, n);
  };

  const weeklyPerformance = {
    week1: {
      assignmentHomework: getWeeklyMark('week1', 'assignmentHomework'),
      activityEngagement: getWeeklyMark('week1', 'activityEngagement'),
    },
    week2: {
      assignmentHomework: getWeeklyMark('week2', 'assignmentHomework'),
      activityEngagement: getWeeklyMark('week2', 'activityEngagement'),
    },
    week3: {
      assignmentHomework: getWeeklyMark('week3', 'assignmentHomework'),
      activityEngagement: getWeeklyMark('week3', 'activityEngagement'),
    },
    week4: {
      assignmentHomework: getWeeklyMark('week4', 'assignmentHomework'),
      activityEngagement: getWeeklyMark('week4', 'activityEngagement'),
    },
  };

  const internalMark = getNum(body.internalMark);
  const theoryMark = getNum(body.theoryMark);
  const practicalMark = getNum(body.practicalMark);
  const totalMark = (body.totalMark !== undefined && body.totalMark !== null && String(body.totalMark).trim() !== '')
    ? getNum(body.totalMark)
    : (internalMark + theoryMark + practicalMark);

  return {
    weeklyPerformance,
    // Sync legacy week fields for backward compatibility
    week1: {
      assignmentHomework: String(weeklyPerformance.week1.assignmentHomework),
      activityEngagement: String(weeklyPerformance.week1.activityEngagement),
      weeklyMark: weeklyPerformance.week1.assignmentHomework + weeklyPerformance.week1.activityEngagement,
    },
    week2: {
      assignmentHomework: String(weeklyPerformance.week2.assignmentHomework),
      activityEngagement: String(weeklyPerformance.week2.activityEngagement),
      weeklyMark: weeklyPerformance.week2.assignmentHomework + weeklyPerformance.week2.activityEngagement,
    },
    week3: {
      assignmentHomework: String(weeklyPerformance.week3.assignmentHomework),
      activityEngagement: String(weeklyPerformance.week3.activityEngagement),
      weeklyMark: weeklyPerformance.week3.assignmentHomework + weeklyPerformance.week3.activityEngagement,
    },
    week4: {
      assignmentHomework: String(weeklyPerformance.week4.assignmentHomework),
      activityEngagement: String(weeklyPerformance.week4.activityEngagement),
      weeklyMark: weeklyPerformance.week4.assignmentHomework + weeklyPerformance.week4.activityEngagement,
    },
    internalMark,
    theoryMark,
    practicalMark,
    totalMark,
    academicPerformance: body.academicPerformance ? String(body.academicPerformance).trim() : '',
    assignmentCompletion: body.assignmentCompletion ? String(body.assignmentCompletion).trim() : '',
    practicalSkills: body.practicalSkills ? String(body.practicalSkills).trim() : '',
    overallProgress: body.overallProgress ? String(body.overallProgress).trim() : '',
  };
}

// GET /admin/certificates — Student Management Page
exports.index = async (req, res, next) => {
  try {
    const { page = 1, search = '' } = req.query;
    const filter = {};

    if (search && search.trim()) {
      const s = search.trim();
      filter.$or = [
        { fullName: { $regex: s, $options: 'i' } },
        { name: { $regex: s, $options: 'i' } },
        { email: { $regex: s, $options: 'i' } },
        { certificateNumber: { $regex: s, $options: 'i' } },
        { studentId: { $regex: s, $options: 'i' } },
      ];
    }

    const result = await paginate(CertificateStudent, filter, {
      page,
      limit: 10,
      sort: { createdAt: -1 },
      populate: 'courseId',
    });

    res.render('admin/certificates/index', {
      title: 'Certificate Students — Admin',
      layout: 'layouts/admin',
      ...result,
      search: search.trim(),
      currentPage: 'certificates',
    });
  } catch (err) {
    next(err);
  }
};

// GET /admin/certificates/create — Show create student form
exports.getCreate = async (req, res, next) => {
  try {
    const courses = await Course.find().sort({ title: 1 });

    res.render('admin/certificates/create', {
      title: 'Add Student — Admin',
      layout: 'layouts/admin',
      courses,
      currentPage: 'certificates',
    });
  } catch (err) {
    next(err);
  }
};

// POST /admin/certificates/create — Create a new student
exports.postCreate = async (req, res, next) => {
  try {
    const {
      fullName, email, phone, qualification, profileImage,
      courseId, progressCard, studentId, verificationStatus,
    } = req.body;

    // Validate required fields
    if (!fullName || !fullName.trim()) {
      req.flash('error', 'Student full name is required.');
      return res.redirect('/admin/certificates/create');
    }
    if (!email || !email.trim()) {
      req.flash('error', 'Student email is required.');
      return res.redirect('/admin/certificates/create');
    }
    if (!courseId) {
      req.flash('error', 'Please select a course.');
      return res.redirect('/admin/certificates/create');
    }

    const course = await Course.findById(courseId);
    if (!course) {
      req.flash('error', 'The selected course does not exist.');
      return res.redirect('/admin/certificates/create');
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check for duplicate email+course
    const existing = await CertificateStudent.findOne({
      email: normalizedEmail,
      courseId: course._id,
    });
    if (existing) {
      req.flash('error', 'A student with this email already exists for the selected course.');
      return res.redirect('/admin/certificates/create');
    }

    // Generate unique certificate number
    const certificateNumber = await generateUniqueCertificateNumber();

    // Generate or use provided studentId
    let finalStudentId = studentId && studentId.trim() ? studentId.trim() : await generateUniqueStudentId();

    // Check studentId uniqueness
    if (finalStudentId) {
      const sidExists = await CertificateStudent.findOne({ studentId: finalStudentId });
      if (sidExists) {
        req.flash('error', `Student ID "${finalStudentId}" is already in use. Please choose a different one.`);
        return res.redirect('/admin/certificates/create');
      }
    }

    const progressFields = extractProgressFields(req.body);

    await CertificateStudent.create({
      fullName: fullName.trim(),
      name: fullName.trim(),
      email: normalizedEmail,
      phone: phone ? phone.trim() : '',
      qualification: qualification ? qualification.trim() : '',
      profileImage: profileImage ? profileImage.trim() : '',
      courseId: course._id,
      certificateNumber,
      issuedDate: new Date(),
      isActive: true,
      marks: progressFields.totalMark || 0,
      totalMark: progressFields.totalMark || 0,
      progressCard: progressCard ? progressCard.trim() : '',
      studentId: finalStudentId,
      verificationStatus: verificationStatus === 'true' || verificationStatus === true,
      ...progressFields,
    });

    req.flash('success', `Student "${fullName.trim()}" created successfully with certificate ${certificateNumber}.`);
    res.redirect('/admin/certificates');
  } catch (err) {
    next(err);
  }
};

// GET /admin/certificates/:id/edit — Show edit student form
exports.getEdit = async (req, res, next) => {
  try {
    const student = await CertificateStudent.findById(req.params.id).populate('courseId');
    if (!student) {
      req.flash('error', 'Student record not found.');
      return res.redirect('/admin/certificates');
    }

    const courses = await Course.find().sort({ title: 1 });

    // Prepare migration-safe weekly performance numbers (0-5)
    const wp = student.weeklyPerformance || {};
    const parseWeeklyVal = (val, legacy) => {
      if (typeof val === 'number' && !isNaN(val)) return Math.min(5, Math.max(0, val));
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        const n = parseFloat(val);
        if (!isNaN(n)) return Math.min(5, Math.max(0, n));
      }
      if (typeof legacy === 'number' && !isNaN(legacy)) return Math.min(5, Math.max(0, legacy));
      if (legacy && typeof legacy === 'string') {
        const match = legacy.match(/(\d+(\.\d+)?)/);
        if (match) {
          const n = parseFloat(match[1]);
          if (!isNaN(n)) return Math.min(5, Math.max(0, n));
        }
      }
      return 0;
    };

    const weeklyPerformance = {
      week1: {
        assignmentHomework: parseWeeklyVal(wp.week1?.assignmentHomework, student.week1?.assignmentHomework),
        activityEngagement: parseWeeklyVal(wp.week1?.activityEngagement, student.week1?.activityEngagement),
      },
      week2: {
        assignmentHomework: parseWeeklyVal(wp.week2?.assignmentHomework, student.week2?.assignmentHomework),
        activityEngagement: parseWeeklyVal(wp.week2?.activityEngagement, student.week2?.activityEngagement),
      },
      week3: {
        assignmentHomework: parseWeeklyVal(wp.week3?.assignmentHomework, student.week3?.assignmentHomework),
        activityEngagement: parseWeeklyVal(wp.week3?.activityEngagement, student.week3?.activityEngagement),
      },
      week4: {
        assignmentHomework: parseWeeklyVal(wp.week4?.assignmentHomework, student.week4?.assignmentHomework),
        activityEngagement: parseWeeklyVal(wp.week4?.activityEngagement, student.week4?.activityEngagement),
      },
    };

    const week1Total = weeklyPerformance.week1.assignmentHomework + weeklyPerformance.week1.activityEngagement;
    const week2Total = weeklyPerformance.week2.assignmentHomework + weeklyPerformance.week2.activityEngagement;
    const week3Total = weeklyPerformance.week3.assignmentHomework + weeklyPerformance.week3.activityEngagement;
    const week4Total = weeklyPerformance.week4.assignmentHomework + weeklyPerformance.week4.activityEngagement;
    const weeklyPerformanceTotal = week1Total + week2Total + week3Total + week4Total;

    res.render('admin/certificates/edit', {
      title: `Edit ${student.fullName || student.name} — Admin`,
      layout: 'layouts/admin',
      student,
      weeklyPerformance,
      week1Total,
      week2Total,
      week3Total,
      week4Total,
      weeklyPerformanceTotal,
      courses,
      currentPage: 'certificates',
    });
  } catch (err) {
    next(err);
  }
};

// POST /admin/certificates/:id/update — Update student details
exports.postUpdate = async (req, res, next) => {
  try {
    const student = await CertificateStudent.findById(req.params.id);
    if (!student) {
      req.flash('error', 'Student record not found.');
      return res.redirect('/admin/certificates');
    }

    const {
      fullName, email, phone, qualification, profileImage,
      courseId, progressCard, studentId, verificationStatus,
      certificateNumber,
    } = req.body;

    // Validate required fields
    if (!fullName || !fullName.trim()) {
      req.flash('error', 'Student full name is required.');
      return res.redirect(`/admin/certificates/${req.params.id}/edit`);
    }
    if (!email || !email.trim()) {
      req.flash('error', 'Student email is required.');
      return res.redirect(`/admin/certificates/${req.params.id}/edit`);
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check for duplicate email+course (excluding current student)
    if (courseId) {
      const existing = await CertificateStudent.findOne({
        email: normalizedEmail,
        courseId,
        _id: { $ne: student._id },
      });
      if (existing) {
        req.flash('error', 'Another student with this email already exists for the selected course.');
        return res.redirect(`/admin/certificates/${req.params.id}/edit`);
      }
    }

    // Check studentId uniqueness (excluding current)
    const newStudentId = studentId ? studentId.trim() : '';
    if (newStudentId) {
      const sidExists = await CertificateStudent.findOne({
        studentId: newStudentId,
        _id: { $ne: student._id },
      });
      if (sidExists) {
        req.flash('error', `Student ID "${newStudentId}" is already in use by another student.`);
        return res.redirect(`/admin/certificates/${req.params.id}/edit`);
      }
    }

    // Validation for weekly performance marks (0 - 5 each)
    const wpPayload = req.body.weeklyPerformance || {};
    for (let w = 1; w <= 4; w++) {
      const weekKey = `week${w}`;
      const weekObj = wpPayload[weekKey] || req.body[weekKey] || {};
      const ahRaw = weekObj.assignmentHomework !== undefined ? weekObj.assignmentHomework : req.body[`${weekKey}_assignmentHomework`];
      const aeRaw = weekObj.activityEngagement !== undefined ? weekObj.activityEngagement : req.body[`${weekKey}_activityEngagement`];

      if (ahRaw !== undefined && ahRaw !== null && String(ahRaw).trim() !== '') {
        const ah = Number(ahRaw);
        if (isNaN(ah) || ah < 0 || ah > 5) {
          req.flash('error', `Week ${w} Assignment / Homework must be a number between 0 and 5.`);
          return res.redirect(`/admin/certificates/${req.params.id}/edit`);
        }
      }
      if (aeRaw !== undefined && aeRaw !== null && String(aeRaw).trim() !== '') {
        const ae = Number(aeRaw);
        if (isNaN(ae) || ae < 0 || ae > 5) {
          req.flash('error', `Week ${w} Activity / Engagement must be a number between 0 and 5.`);
          return res.redirect(`/admin/certificates/${req.params.id}/edit`);
        }
      }
    }

    // Validation for final assessment and overall marks
    const markValidations = [
      { label: 'Total Mark', val: req.body.totalMark },
      { label: 'Internal Mark', val: req.body.internalMark },
      { label: 'Theory Mark', val: req.body.theoryMark },
      { label: 'Practical Mark', val: req.body.practicalMark },
      { label: 'Total Mark', val: req.body.totalMark },
    ];

    for (const item of markValidations) {
      if (item.val !== undefined && item.val !== null && String(item.val).trim() !== '') {
        const num = Number(item.val);
        if (isNaN(num) || num < 0) {
          req.flash('error', `${item.label} must be a valid non-negative number.`);
          return res.redirect(`/admin/certificates/${req.params.id}/edit`);
        }
      }
    }

    const progressFields = extractProgressFields(req.body);

    // Update fields
    student.fullName = fullName.trim();
    student.name = fullName.trim();
    student.email = normalizedEmail;
    student.phone = phone ? phone.trim() : '';
    student.qualification = qualification ? qualification.trim() : '';
    student.profileImage = profileImage ? profileImage.trim() : '';
    if (courseId) student.courseId = courseId;
    if (certificateNumber && certificateNumber.trim()) {
      student.certificateNumber = certificateNumber.trim();
    }
    student.marks = progressFields.totalMark || 0;
    student.progressCard = progressCard ? progressCard.trim() : '';
    student.studentId = newStudentId || student.studentId;
    student.verificationStatus = verificationStatus === 'true' || verificationStatus === true;

    // Assign progress fields
    Object.assign(student, progressFields);

    await student.save();

    req.flash('success', `Student "${student.fullName}" updated successfully.`);
    res.redirect('/admin/certificates');
  } catch (err) {
    next(err);
  }
};

// GET /admin/certificates/upload — Show Excel upload form
exports.getUpload = async (req, res, next) => {
  try {
    const courses = await Course.find().sort({ title: 1 });
    const importResult = req.session.importResult || null;
    delete req.session.importResult;

    res.render('admin/certificates/upload', {
      title: 'Upload Students — Certificates',
      layout: 'layouts/admin',
      courses,
      importResult,
      currentPage: 'certificates-upload',
    });
  } catch (err) {
    next(err);
  }
};

// POST /admin/certificates/upload — Handle Excel file parsing & student import
exports.postUpload = async (req, res, next) => {
  try {
    const { courseId } = req.body;

    // 1. Validate course selection
    if (!courseId) {
      req.flash('error', 'Please select a course before uploading.');
      return res.redirect('/admin/certificates/upload');
    }

    const course = await Course.findById(courseId);
    if (!course) {
      req.flash('error', 'The selected course does not exist.');
      return res.redirect('/admin/certificates/upload');
    }

    // 2. Validate file existence
    if (!req.file) {
      req.flash('error', 'Please upload a valid Excel file (.xlsx).');
      return res.redirect('/admin/certificates/upload');
    }

    // 3. Parse Excel using xlsx package
    let workbook;
    try {
      workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    } catch (parseErr) {
      req.flash('error', 'Unable to parse Excel file. Please ensure it is a valid .xlsx file.');
      return res.redirect('/admin/certificates/upload');
    }

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      req.flash('error', 'The uploaded Excel file contains no worksheets.');
      return res.redirect('/admin/certificates/upload');
    }

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(worksheet, { defval: '' });

    if (!rows || rows.length === 0) {
      req.flash('error', 'The uploaded Excel sheet contains no data rows.');
      return res.redirect('/admin/certificates/upload');
    }

    let importedCount = 0;
    let skippedCount = 0;

    // 4. Process each row
    for (const row of rows) {
      // Map Excel columns to fields
      const fullName = getRowValue(row, ['Full name', 'Full Name', 'fullName', 'fullname', 'Name', 'name']);
      const email = getRowValue(row, ['Email', 'email', 'Email Address', 'emailaddress']);
      const phone = getRowValue(row, ['phone', 'Phone', 'Phone Number', 'phonenumber', 'Mobile', 'mobile']);
      const qualification = getRowValue(row, ['Qualification', 'qualification', 'degree']);
      const profileImage = getRowValue(row, ['Your picture', 'Your Picture', 'yourpicture', 'picture', 'profileImage', 'Photo', 'photo']);
      const marksStr = getRowValue(row, ['Marks', 'marks', 'Score', 'score']);
      const progressCardStr = getRowValue(row, ['Progress Card', 'ProgressCard', 'progressCard', 'progresscard', 'Progress', 'progress', 'Remarks', 'remarks']);
      const studentIdStr = getRowValue(row, ['Student ID', 'StudentID', 'studentId', 'studentid', 'SID', 'sid']);

      // Skip row if full name or email is missing
      if (!fullName || !email) {
        skippedCount++;
        continue;
      }

      const normalizedEmail = email.toLowerCase().trim();

      // 5. Skip duplicate email + course combinations
      const existing = await CertificateStudent.findOne({
        email: normalizedEmail,
        courseId: course._id,
      });

      if (existing) {
        skippedCount++;
        continue;
      }

      // 6. Generate unique certificateNumber automatically
      const certificateNumber = await generateUniqueCertificateNumber();

      // 7. Generate or use provided studentId
      let finalStudentId = studentIdStr || await generateUniqueStudentId();
      // Check uniqueness; if collision, auto-generate
      const sidConflict = await CertificateStudent.findOne({ studentId: finalStudentId });
      if (sidConflict) {
        finalStudentId = await generateUniqueStudentId();
      }

      // 8. Create CertificateStudent record
      await CertificateStudent.create({
        fullName,
        name: fullName,
        email: normalizedEmail,
        phone,
        qualification,
        profileImage,
        courseId: course._id,
        certificateNumber,
        issuedDate: new Date(),
        isActive: true,
        marks: marksStr ? parseInt(marksStr, 10) || 0 : 0,
        totalMark: marksStr ? parseInt(marksStr, 10) || 0 : 0,
        progressCard: progressCardStr || '',
        studentId: finalStudentId,
        verificationStatus: true,
      });

      importedCount++;
    }

    // 9. Flash message & summary results
    req.session.importResult = {
      courseTitle: course.title,
      totalRows: rows.length,
      importedCount,
      skippedCount,
    };

    if (importedCount > 0) {
      req.flash(
        'success',
        `Import completed: ${importedCount} student(s) successfully imported, ${skippedCount} duplicate/invalid row(s) skipped.`
      );
    } else {
      req.flash(
        'error',
        `No new students imported. ${skippedCount} row(s) were skipped (either duplicate email for this course or missing required fields).`
      );
    }

    res.redirect('/admin/certificates/upload');
  } catch (err) {
    next(err);
  }
};

// POST /admin/certificates/:id/toggle-active — Toggle student active status (AJAX)
exports.toggleActive = async (req, res, next) => {
  try {
    const student = await CertificateStudent.findById(req.params.id);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student record not found' });
    }

    student.isActive = !student.isActive;
    await student.save();

    res.json({ success: true, isActive: student.isActive });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /admin/certificates/:id/delete — Delete a student certificate record
exports.deleteStudent = async (req, res, next) => {
  try {
    const student = await CertificateStudent.findByIdAndDelete(req.params.id);
    if (!student) {
      req.flash('error', 'Student record not found.');
    } else {
      req.flash('success', `Student "${student.fullName || student.name}" deleted successfully.`);
    }
    res.redirect('/admin/certificates');
  } catch (err) {
    next(err);
  }
};
