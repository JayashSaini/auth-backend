require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const morgan = require('morgan');
const requestIp = require('request-ip');
const { rateLimit } = require('express-rate-limit');

const { ApiResponse } = require('./utils/ApiResponse.js');
const { ApiError } = require('./utils/ApiError.js');
const { errorHandler } = require('./middlewares/error.middleware.js');
const { RATE_LIMIT_CONFIG } = require('./constants.js');
const ipBlockService = require('./services/ipBlock.service.js');

const app = express();

/* 
|--------------------------------------------------------------------------
| Middleware Configuration
|--------------------------------------------------------------------------
*/

// Enable CORS with credentials support
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  })
);

// Attach client IP address to requests
app.use(requestIp.mw());

// Apply rate limiting to prevent abuse and excessive API requests
const limiter = rateLimit({
  windowMs: RATE_LIMIT_CONFIG.WINDOW_DURATION, // Request window duration (e.g., 1 minute)
  max: RATE_LIMIT_CONFIG.API_LIMIT, // Max requests per window
  standardHeaders: true, // Use standard rate limit headers
  legacyHeaders: false, // Disable deprecated rate limit headers
  keyGenerator: (req) => req.clientIp || 'unknown-ip',
  handler: async (req, _, __, options) => {
    const clientIp = req.clientIp || 'unknown-ip';

    // Block IP temporarily if the rate limit is exceeded
    await ipBlockService.blockIp(clientIp, RATE_LIMIT_CONFIG.BLOCK_DURATION);

    throw new ApiError(
      429,
      `Too many requests. Your IP has been blocked for ${RATE_LIMIT_CONFIG.BLOCK_DURATION} hours due to excessive requests.`
    );
  },
});
app.use(limiter); // Apply rate limiting middleware

// Parse JSON and URL-encoded data with size limits
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files from the 'public' directory
app.use(express.static('public'));

// Parse cookies from incoming requests
app.use(cookieParser());

// Set security headers using Helmet
app.use(helmet());

// Log HTTP requests using Morgan (detailed logs in production)
app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'));

/* 
|--------------------------------------------------------------------------
| Routes
|--------------------------------------------------------------------------
*/

const userRoutes = require('./routes/user/user.routes.js');

app.use('/api/v1/user', userRoutes);

// Health check endpoint
app.get('/api/v1/healthcheck', (req, res) => {
  res.status(200).json(new ApiResponse(200, null, 'Server is running!'));
});

// Handle undefined routes
app.use((_, __, next) => {
  next(new ApiError(404, 'Endpoint not found'));
});

/* 
|--------------------------------------------------------------------------
| Error Handling Middleware
|--------------------------------------------------------------------------
*/

// Global error handler
app.use(errorHandler);

module.exports = { app };
