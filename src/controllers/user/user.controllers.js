const User = require('../../models/user/user.models.js');
const {
  emailVerificationMailgenContent,
  sendEmail,
  forgotSendMail,
} = require('../../utils/mail.js');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const moment = require('moment');

const {
  UserLoginType,
  USER_OTP_EXPIRY,
  UserRolesEnum,
} = require('../../constants.js');
const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const { asyncHandler } = require('../../utils/asyncHandler.js');
const { uploadOnCloudinary } = require('../../utils/cloudinary.js');
const { default: mongoose } = require('mongoose');

const generateAccessAndRefreshTokens = async (userId) => {
  try {
    const user = await User.findById(userId);

    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    // attach refresh token to the user document to avoid refreshing the access token with multiple refresh tokens
    user.refreshToken = refreshToken;

    await user.save({ validateBeforeSave: false });
    return { accessToken, refreshToken };
  } catch (error) {
    throw new ApiError(
      500,
      'Something went wrong while generating the access token'
    );
  }
};

const options = {
  maxAge: 24 * 60 * 60 * 1000 * 10, // Cookie will expire after 1 day
  httpOnly: true, // Cookie is only accessible via HTTP(S) and not client-side JavaScript
  secure: process.env.NODE_ENV === 'production', // Cookie will only be sent over HTTPS if in production
  sameSite: 'strict', // SameSite attribute to prevent CSRF attacks
};

function generateOtp() {
  const currentTime = moment();
  const otp = {};
  otp.otp = Math.floor(100000 + Math.random() * 900000);
  otp.expiryDate = currentTime.add(String(USER_OTP_EXPIRY), 'minutes');
  return otp;
}

const userRegister = asyncHandler(async (req, res) => {
  const { email, username, password, role } = req.body;
  const user = await User.create({
    email,
    password,
    username,
    isEmailVerified: false,
    role: role || UserRolesEnum.USER,
    loginType: UserLoginType.EMAIL_PASSWORD,
  });

  const { unHashedToken, hashedToken, tokenExpiry } =
    user.generateTemporaryToken();

  /**
   * assign hashedToken and tokenExpiry in DB till user clicks on email verification link
   * The email verification is handled by {@link verifyEmail}
   */
  user.emailVerificationToken = hashedToken;
  user.emailVerificationExpiry = tokenExpiry;
  await user.save({ validateBeforeSave: false });

  await sendEmail({
    email: user?.email,
    subject: 'Please verify your email',
    mailgenContent: emailVerificationMailgenContent(
      user?.username || 'Buddy',
      `${process.env.CLIENT_URI}/auth/email-verification/${unHashedToken}`
    ),
  });

  const createdUser = await User.findById(user._id).select(
    '-password -refreshToken -emailVerificationToken -emailVerificationExpiry'
  );

  if (!createdUser) {
    throw new ApiError(500, 'Something went wrong while registering the user');
  }

  return res
    .status(201)
    .json(
      new ApiResponse(
        200,
        { user: createdUser },
        'Users registered successfully'
      )
    );
});

const userLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({
    email,
  });

  if (!user) {
    throw new ApiError(404, 'User does not exist');
  }

  if (user.loginType !== UserLoginType.EMAIL_PASSWORD) {
    throw new ApiError(
      400,
      'You have previously registered using ' +
        user.loginType?.toLowerCase() +
        '. Please use the ' +
        user.loginType?.toLowerCase() +
        ' login option to access your account.'
    );
  }

  // Compare the incoming password with hashed password
  const isPasswordValid = await user.isPasswordCorrect(password);

  if (!isPasswordValid) {
    throw new ApiError(400, 'Invalid Password');
  }

  const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(
    user._id
  );

  // get the user document ignoring the password and refreshToken field
  const loggedInUser = await User.findById(user._id).select(
    '-password -refreshToken -emailVerificationToken -emailVerificationExpiry'
  );

  return res
    .status(200)
    .cookie('accessToken', accessToken, options) // set the access token in the cookie
    .cookie('refreshToken', refreshToken, options) // set the refresh token in the cookie
    .json(
      new ApiResponse(
        200,
        { user: loggedInUser, accessToken, refreshToken }, // send access and refresh token in response if client decides to save them by themselves
        'User logged in successfully'
      )
    );
});

const userLogout = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(
    req.user._id,
    {
      $set: {
        refreshToken: undefined,
      },
    },
    { new: true }
  );

  return res
    .status(200)
    .clearCookie('accessToken', options)
    .clearCookie('refreshToken', options)
    .json(new ApiResponse(200, {}, 'User logged out'));
});

const verifyEmail = asyncHandler(async (req, res) => {
  const { verificationToken } = req.params;

  if (!verificationToken) {
    throw new ApiError(400, 'Email verification token is missing');
  }

  // generate a hash from the token that we are receiving
  let hashedToken = crypto
    .createHash('sha256')
    .update(verificationToken)
    .digest('hex');

  const user = await User.findOne({
    emailVerificationToken: hashedToken,
    emailVerificationExpiry: { $gt: Date.now() },
  });

  if (!user) {
    throw new ApiError(489, 'Token is invalid or expired');
  }

  // If we found the user that means the token is valid
  // Now we can remove the associated email token and expiry date as we no  longer need them
  user.emailVerificationToken = undefined;
  user.emailVerificationExpiry = undefined;
  // Tun the email verified flag to `true`
  user.isEmailVerified = true;
  await user.save({ validateBeforeSave: false });

  return res
    .status(200)
    .json(new ApiResponse(200, { isEmailVerified: true }, 'Email is verified'));
});

const refreshAccessToken = asyncHandler(async (req, res) => {
  const incomingRefreshToken =
    req.cookies.refreshToken || req.body.refreshToken;

  if (!incomingRefreshToken) {
    throw new ApiError(401, 'Unauthorized request');
  }

  try {
    const decodedToken = jwt.verify(
      incomingRefreshToken,
      process.env.REFRESH_TOKEN_SECRET
    );
    const user = await User.findById(decodedToken?._id);
    if (!user) {
      throw new ApiError(401, 'Invalid refresh token');
    }

    // check if incoming refresh token is same as the refresh token attached in the user document
    // This shows that the refresh token is used or not
    // Once it is used, we are replacing it with new refresh token below
    if (incomingRefreshToken !== user?.refreshToken) {
      // If token is valid but is used already
      throw new ApiError(401, 'Refresh token is expired or used');
    }

    const { accessToken, refreshToken: newRefreshToken } =
      await generateAccessAndRefreshTokens(user._id);

    return res
      .status(200)
      .cookie('accessToken', accessToken, options)
      .cookie('refreshToken', newRefreshToken, options)
      .json(
        new ApiResponse(
          200,
          { accessToken, refreshToken: newRefreshToken },
          'Access token refreshed'
        )
      );
  } catch (error) {
    throw new ApiError(401, error?.message || 'Invalid refresh token');
  }
});

const forgotPasswordRequest = asyncHandler(async (req, res) => {
  const { email } = req.body;

  // Get email from the client and check if user exists
  const user = await User.findOne({ email }).select(
    '+emailVerificationToken +emailVerificationExpiry'
  );
  if (!user) {
    throw new ApiError(404, 'User does not exists', []);
  }
  if (!user.isEmailVerified) {
    throw new ApiError(404, 'User email is not verified');
  }

  if (!(user.loginType === UserLoginType.EMAIL_PASSWORD)) {
    throw new ApiError(
      400,
      'You have previously registered using ' +
        user.loginType?.toLowerCase() +
        '. Please use the ' +
        user.loginType?.toLowerCase() +
        ' login option to access your account.'
    );
  }

  const { otp, expiryDate } = generateOtp();

  user.emailVerificationToken = otp;
  user.emailVerificationExpiry = expiryDate;

  // Send mail with the password reset link. It should be the link of the frontend url with token
  await forgotSendMail({
    email: user?.email,
    username: user?.username,
    subject: 'Password reset OTP',
    content: otp,
  });
  await user.save({ validateBeforeSave: false });
  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        {},
        'Password reset mail has been sent on your mail id'
      )
    );
});

const verifyOtp = asyncHandler(async (req, res) => {
  const { otp, email } = req.body;

  const user = await User.findOne({ email }).select(
    '+emailVerificationExpiry +emailVerificationToken'
  );

  if (!user) {
    throw new ApiError(404, "User with this email doesn't exits");
  }
  const time1 = moment(user.emailVerificationExpiry);
  const time2 = moment();

  const isValidOtp = Number(user.emailVerificationToken) === Number(otp);
  const isEmailExpired = time1.isBefore(time2);

  if (isEmailExpired) {
    throw new ApiError(400, 'OTP is Expire!!!');
  } else if (!isValidOtp) {
    throw new ApiError(400, 'OTP is Invalid!!!');
  } else {
    user.emailVerificationExpiry = null;
    user.emailVerificationToken = null;
  }

  const { unHashedToken, hashedToken, tokenExpiry } =
    user.generateTemporaryToken(); // generate password reset

  // save the hashed version a of the token and expiry in the DB
  user.forgotPasswordToken = hashedToken;
  user.forgotPasswordExpiry = tokenExpiry;
  await user.save({ validateBeforeSave: false });

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { token: unHashedToken },
        'OTP verified successfully'
      )
    );
});

const resetForgottenPassword = asyncHandler(async (req, res) => {
  const { resetToken } = req.params;
  const { newPassword } = req.body;

  let hashedToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  // See if user with hash similar to resetToken exists
  // If yes then check if token expiry is greater than current date

  const user = await User.findOne({
    forgotPasswordToken: hashedToken,
    forgotPasswordExpiry: { $gt: Date.now() },
  });

  // If either of the one is false that means the token is invalid or expired
  if (!user) {
    throw new ApiError(489, 'Token is invalid or expired');
  }

  // if everything is ok and token id valid
  // reset the forgot password token and expiry
  user.forgotPasswordToken = undefined;
  user.forgotPasswordExpiry = undefined;

  // Set the provided password as the new password
  user.password = newPassword;
  await user.save({ validateBeforeSave: false });
  return res
    .status(200)
    .json(new ApiResponse(200, {}, 'Password reset successfully'));
});

const resendEmailVerification = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email || email.length === 0) {
    throw new ApiError(400, 'Email is required');
  }

  const user = await User.findOne({ email });
  if (!user) {
    throw new ApiError(404, "User doesn't exits");
  }
  if (user.isEmailVerified) {
    throw new ApiError(400, 'User is already verified');
  }
  const { unHashedToken, hashedToken, tokenExpiry } =
    user.generateTemporaryToken();

  user.emailVerificationToken = hashedToken;
  user.emailVerificationExpiry = tokenExpiry;
  await user.save({ validateBeforeSave: false });

  await sendEmail({
    email: user?.email,
    subject: 'Please verify your email',
    mailgenContent: emailVerificationMailgenContent(
      user?.username || 'Buddy',
      `${process.env.CLIENT_URI}/auth/email-verification/${unHashedToken}`
    ),
  });
  return res
    .status(200)
    .json(new ApiResponse(200, {}, 'Mail has been sent to your mail ID'));
});

const userSelf = asyncHandler(async (req, res) => {
  return res.status(200).json(
    new ApiResponse(
      200,
      {
        user: req.user,
        accessToken: req.cookies.accessToken,
      },
      'User fetched successfully'
    )
  );
});

const updateAvatar = asyncHandler(async (req, res) => {
  const avatarLocalPath = req.file?.path;

  if (!avatarLocalPath) {
    throw new ApiError(400, 'Avatar file is missing');
  }

  const avatar = await uploadOnCloudinary(avatarLocalPath, true);

  if (!avatar.url) {
    throw new ApiError(400, 'Error while uploading on avatar');
  }

  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        avatar: {
          url: avatar?.url,
          public_id: String(avatar?.public_id),
        },
      },
    },
    { new: true }
  ).select('-password');

  return res
    .status(200)
    .json(new ApiResponse(200, user, 'Avatar updated successfully!'));
});

module.exports = {
  userRegister,
  userLogin,
  userLogout,
  verifyEmail,
  refreshAccessToken,
  forgotPasswordRequest,
  resetForgottenPassword,
  verifyOtp,
  resendEmailVerification,
  userSelf,
  generateAccessAndRefreshTokens,
  updateAvatar,
};
