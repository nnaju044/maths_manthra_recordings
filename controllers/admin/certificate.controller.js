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
      // Map Excel columns to fields:
      // "Full name" -> fullName
      // "Email" -> email
      // "phone" -> phone
      // "Qualification" -> qualification
      // "Your picture" -> profileImage
      const fullName = getRowValue(row, ['Full name', 'Full Name', 'fullName', 'fullname', 'Name', 'name']);
      const email = getRowValue(row, ['Email', 'email', 'Email Address', 'emailaddress']);
      const phone = getRowValue(row, ['phone', 'Phone', 'Phone Number', 'phonenumber', 'Mobile', 'mobile']);
      const qualification = getRowValue(row, ['Qualification', 'qualification', 'degree']);
      const profileImage = getRowValue(row, ['Your picture', 'Your Picture', 'yourpicture', 'picture', 'profileImage', 'Photo', 'photo']);

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

      // 7. Create CertificateStudent record
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
      });

      importedCount++;
    }

    // 8. Flash message & summary results
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
