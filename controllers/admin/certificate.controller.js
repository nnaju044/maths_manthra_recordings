/**
 * controllers/admin/certificate.controller.js
 * Excel import and management for certificate students.
 */
const crypto = require('crypto');
const xlsx = require('xlsx');
const CertificateStudent = require('../../models/CertificateStudent');
const Course = require('../../models/Course');
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
 * Generate a collision-resistant unique certificate number
 * Format: MMC-YYYY-HEX6-RAND4 (e.g. MMC-2026-F4C91A-4819)
 */
async function generateUniqueCertificateNumber() {
  const year = new Date().getFullYear();
  let certNumber = '';
  let exists = true;
  let attempts = 0;

  while (exists && attempts < 10) {
    attempts++;
    const randomHex = crypto.randomBytes(3).toString('hex').toUpperCase();
    const randomSeq = Math.floor(1000 + Math.random() * 9000);
    certNumber = `MMC-${year}-${randomHex}-${randomSeq}`;
    exists = await CertificateStudent.exists({ certificateNumber: certNumber });
  }

  return certNumber;
}

/**
 * Generate a unique student ID
 * Format: MMS-YYYY-RAND6 (e.g. MMS-2026-482917)
 */
async function generateUniqueStudentId() {
  const year = new Date().getFullYear();
  let sid = '';
  let exists = true;
  let attempts = 0;

  while (exists && attempts < 10) {
    attempts++;
    const randomSeq = Math.floor(100000 + Math.random() * 900000);
    sid = `MMS-${year}-${randomSeq}`;
    exists = await CertificateStudent.exists({ studentId: sid });
  }

  return sid;
}

/**
 * Helper to extract nested progress fields from req.body
 */
function extractProgressFields(body) {
  const getNested = (week, field) => {
    if (body[week] && typeof body[week] === 'object' && body[week][field] !== undefined) {
      return String(body[week][field]).trim();
    }
    if (body[`${week}_${field}`] !== undefined) {
      return String(body[`${week}_${field}`]).trim();
    }
    return '';
  };
  const getNum = (val) => {
    if (val === undefined || val === null || String(val).trim() === '') return 0;
    const n = Number(val);
    return isNaN(n) ? 0 : Math.max(0, n);
  };

  const internalMark = getNum(body.internalMark);
  const theoryMark = getNum(body.theoryMark);
  const practicalMark = getNum(body.practicalMark);
  const totalMark = (body.totalMark !== undefined && body.totalMark !== null && String(body.totalMark).trim() !== '')
    ? getNum(body.totalMark)
    : (internalMark + theoryMark + practicalMark);

  return {
    week1: {
      classPerformance: getNested('week1', 'classPerformance'),
      assignmentHomework: getNested('week1', 'assignmentHomework'),
      activityEngagement: getNested('week1', 'activityEngagement'),
      weeklyMark: getNum(getNested('week1', 'weeklyMark')),
    },
    week2: {
      classPerformance: getNested('week2', 'classPerformance'),
      assignmentHomework: getNested('week2', 'assignmentHomework'),
      activityEngagement: getNested('week2', 'activityEngagement'),
      weeklyMark: getNum(getNested('week2', 'weeklyMark')),
    },
    week3: {
      classPerformance: getNested('week3', 'classPerformance'),
      assignmentHomework: getNested('week3', 'assignmentHomework'),
      activityEngagement: getNested('week3', 'activityEngagement'),
      weeklyMark: getNum(getNested('week3', 'weeklyMark')),
    },
    week4: {
      classPerformance: getNested('week4', 'classPerformance'),
      assignmentHomework: getNested('week4', 'assignmentHomework'),
      activityEngagement: getNested('week4', 'activityEngagement'),
      weeklyMark: getNum(getNested('week4', 'weeklyMark')),
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
      courseId, marks, progressCard, studentId, verificationStatus,
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
      marks: marks ? parseInt(marks, 10) || 0 : 0,
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

    res.render('admin/certificates/edit', {
      title: `Edit ${student.fullName || student.name} — Admin`,
      layout: 'layouts/admin',
      student,
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
      courseId, marks, progressCard, studentId, verificationStatus,
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

    // Validation for marks
    const markValidations = [
      { label: 'Marks', val: marks },
      { label: 'Week 1 Mark', val: req.body.week1?.weeklyMark || req.body.week1_weeklyMark },
      { label: 'Week 2 Mark', val: req.body.week2?.weeklyMark || req.body.week2_weeklyMark },
      { label: 'Week 3 Mark', val: req.body.week3?.weeklyMark || req.body.week3_weeklyMark },
      { label: 'Week 4 Mark', val: req.body.week4?.weeklyMark || req.body.week4_weeklyMark },
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
    student.marks = marks ? parseInt(marks, 10) || 0 : 0;
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
