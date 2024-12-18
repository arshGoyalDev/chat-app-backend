import express from "express";
import cors from "cors";

import dotenv from "dotenv";
import cookieParser from "cookie-parser";

import mongoose from "mongoose";

import setupSocket from "./socket.js";

import { authRoutes, contactRoutes, messageRoutes } from "./routes/index.js";

dotenv.config();

const app = express();

const port = process.env.PORT || 3001;
const databaseURL = process.env.DATABASE_URL;

app.use(
  cors({
    origin: [process.env.ORIGIN],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true,
  })
);

app.use("/uploads/profile", express.static("uploads/profile"));

app.use(cookieParser());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/messages", messageRoutes);

const server = app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});

setupSocket(server);

mongoose
  .connect(databaseURL)
  .then(() => console.log(`DB connection successful`))
  .catch((error) => console.log(error.message));
