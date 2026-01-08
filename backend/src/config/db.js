import mongoose from 'mongoose';

export const connectDb = async (uri) => {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  console.log('Mongo connected');
};
