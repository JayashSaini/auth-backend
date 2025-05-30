const { Router } = require('express');
const router = Router();
const {
  userRegister,
  userLogin,
  verifyEmail,
  refreshAccessToken,
  forgotPasswordRequest,
  resetForgottenPassword,
  userLogout,
  verifyOtp,
  resendEmailVerification,
  userSelf,
  updateAvatar,
  generateAccessAndRefreshTokens,
} = require('../../controllers/user/user.controllers.js');
const {
  userRegisterValidator,
  userLoginValidator,
  userForgotPasswordValidator,
  userResetForgottenPasswordValidator,
  userVerifyOtpValidator,
} = require('../../validators/user/user.validators.js');
const { validate } = require('../../validators/validate.js');
const { verifyJWT } = require('../../middlewares/auth.middlewares.js');
const { upload } = require('../../middlewares/multer.middlewares.js');
require('../../config/passport.config.js'); // import the passport config
const passport = require('passport');

//unsecured routes
router.route('/register').post(userRegisterValidator(), validate, userRegister);
router.route('/login').post(userLoginValidator(), validate, userLogin);
router.route('/refresh-token').post(refreshAccessToken);
router.route('/verify-email/:verificationToken').get(verifyEmail);
router.route('/resend-verify-email').post(resendEmailVerification);

router
  .route('/forgot-password')
  .post(userForgotPasswordValidator(), validate, forgotPasswordRequest);

router.route('/verify-otp').post(userVerifyOtpValidator(), validate, verifyOtp);

router
  .route('/reset-password/:resetToken')
  .post(
    userResetForgottenPasswordValidator(),
    validate,
    resetForgottenPassword
  );

// Secured Routes
router.route('/logout').get(verifyJWT, userLogout);
router.route('/self').get(verifyJWT, userSelf);
router.route('/update-avatar').patch(
  verifyJWT,
  upload.single('avatar'), // multer
  updateAvatar
);

//SSO Routes
router.route('/google').get(
  passport.authenticate('google', {
    scope: ['profile', 'email'],
  }),
  (req, res) => {
    console.log('redirecting to google...');
    res.send('redirecting to google...');
  }
);

router.route('/google/callback').get((req, res, next) => {
  // Middleware for passport authentication
  passport.authenticate('google', async (err, user, info) => {
    // Check if there's an error or user object
    if (err || !user) {
      // If there's an error or user object is not found, handle the error response
      if (info && info.redirectTo) {
        // Redirect the user to the specified URL with the error message
        return res.redirect(
          info.redirectTo + '?error=' + encodeURIComponent(info.message)
        );
      }

      // If no redirection specified, handle other types of errors or redirect to a default error page
      return res.redirect('?error=' + encodeURIComponent('unhandled error'));
    }

    // If authentication succeeds, proceed to the next middleware
    const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(
      user._id
    );
    return res
      .status(301)
      .redirect(
        `${process.env.CLIENT_SSO_REDIRECT_URL}/${accessToken}/${refreshToken}`
      );
  })(req, res, next); // Call the middleware with req, res, next
});

module.exports = router;
