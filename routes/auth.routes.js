/**
 * routes/auth.routes.js
 * Admin-only authentication routes — login, logout.
 */
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authController = require('../controllers/auth.controller');

const loginValidation = [
  body('email').isEmail().withMessage('Please enter a valid email.').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required.'),
];

router.get('/login', authController.getLogin);
router.post('/login', loginValidation, authController.postLogin);
router.get('/logout', authController.logout);

module.exports = router;
