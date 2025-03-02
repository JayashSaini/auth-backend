const mongoose = require('mongoose');

// Define the BlockedIP schema
const blockedIPSchema = new mongoose.Schema(
  {
    ip: { type: String, required: true, unique: true, index: true }, // The `ip` field is required, unique, and indexed for faster lookups
    blockedUntil: { type: Date, required: true }, // The `blockedUntil` field is required
  },
  {
    _id: false, // Disable default _id field
    timestamps: true, // Automatically add `createdAt` and `updatedAt` fields
  }
);

// Define the BlockedIP model using `ip` as the _id field
blockedIPSchema.virtual('id').get(function () {
  return this.ip; // Return the `ip` field as the id
});

// Create the BlockedIP model with `ip` as the primary key
module.exports = mongoose.model('BlockedIP', blockedIPSchema);
