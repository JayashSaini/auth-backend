const DB_NAME = 'Cluster-1';
const RATE_LIMIT_CONFIG = {
  WINDOW_DURATION: 5 * 60 * 1000, // 5 minutes
  API_LIMIT: 200,
  BLOCK_DURATION: 24, // hours
};

const UserRolesEnum = {
  ADMIN: 'ADMIN',
  CREATOR: 'CREATOR',
  USER: 'USER',
};
const AvailableUserRoles = Object.values(UserRolesEnum);

const UserLoginType = {
  EMAIL_PASSWORD: 'EMAIL_PASSWORD',
  GOOGLE: 'GOOGLE',
  INSTAGRAM: 'INSTAGRAM',
};

const AvailableSocialLogins = Object.values(UserLoginType);

const USER_OTP_EXPIRY = 20;

const USER_TEMPORARY_TOKEN_EXPIRY = 20 * 60 * 1000; // 20 minutes

module.exports = {
  DB_NAME,
  RATE_LIMIT_CONFIG,
  USER_OTP_EXPIRY,
  AvailableUserRoles,
  UserRolesEnum,
  UserLoginType,
  USER_TEMPORARY_TOKEN_EXPIRY,
  AvailableSocialLogins,
};
