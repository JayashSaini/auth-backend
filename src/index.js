require('dotenv').config({
  path: './.env',
});
const { app } = require('./app.js');
const connectDB = require('./db/index.js');

let server = null;

(async () => {
  try {
    // connect to the database
    await connectDB();
    // start app
    server = app.listen(process.env.PORT, () => {
      console.log(`🚝 Server is running on port ${process.env.PORT}`);
    });
  } catch (error) {
    console.error('Server start error: ', error);
    shutdown('SIGTERM');
  }
})();

// Handle graceful shutdown
const shutdown = (signal) => {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);

  server.close(() => {
    console.log('🚦 Server closed');
    process.exit(0);
  });

  // Force exit if shutdown takes too long
  setTimeout(() => {
    console.error('⚠️ Force shutting down...');
    process.exit(1);
  }, 5000);
};

// Listen for termination signals
process.on('SIGINT', () => shutdown('SIGINT')); // Handle Ctrl + C
process.on('SIGTERM', () => shutdown('SIGTERM')); // Handle process termination
