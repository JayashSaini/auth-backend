const BlockedIP = require('../models/user/ipBlock.model.js'); // Your BlockedIP model

const ipBlockService = {
  async isIpBlocked(ip) {
    const blockedIp = await BlockedIP.findOne({ ip }, 'blockedUntil'); // Performance: Only select needed field
    return Boolean(
      blockedIp?.blockedUntil && blockedIp.blockedUntil > new Date()
    );
  },

  async blockIp(ip, duration = 24) {
    const blockedUntil = new Date(Date.now() + duration * 60 * 60 * 1000); // duration in hours
    await BlockedIP.findOneAndUpdate(
      { ip },
      { $set: { blockedUntil } },
      { upsert: true }
    );
  },
};

module.exports = ipBlockService;
