import mongoose from 'mongoose';

/**
 * Connect MongoDB with pool settings tuned for a small host
 * (e.g. Core i3 / 8GB RAM serving ~10 concurrent users).
 */
const connectDB = async () => {
  try {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/inventory_management';

    const conn = await mongoose.connect(uri, {
      maxPoolSize: Number(process.env.MONGO_MAX_POOL || 10),
      minPoolSize: 1,
      maxIdleTimeMS: 30000,
      serverSelectionTimeoutMS: 5000,
      // Avoid buffering operations forever if DB is down
      bufferCommands: false,
    });

    // Cap mongoose cache behavior; lean queries preferred in controllers where used
    mongoose.set('strictQuery', true);

    console.log(`MongoDB connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error connecting to MongoDB: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;
