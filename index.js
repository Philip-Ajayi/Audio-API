const express = require("express");
const mongoose = require("mongoose");
const fileUpload = require("express-fileupload");
const { google } = require("googleapis");
const fs = require("fs");
require("dotenv").config();

const app = express();

// Middleware
app.use(express.json());
app.use(fileUpload());
app.use(express.urlencoded({ extended: true }));

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
const db = mongoose.connection;
db.on("error", console.error.bind(console, "connection error:"));
db.once("open", () => {
  console.log("Connected to MongoDB");
});

// Define Mongoose Schema
const itemSchema = new mongoose.Schema({
  name: String,
  thumbnail: String,
  date: { type: Date, default: Date.now },
  speaker: String,
  audioFile: String,
  series: String,
});
const Item = mongoose.model("Item", itemSchema);

// Google Drive API setup
const auth = new google.auth.GoogleAuth({
  keyFile: "credentials.json", // Ensure this file is in your project directory
  scopes: ["https://www.googleapis.com/auth/drive"],
});
const drive = google.drive({ version: "v3", auth });

// Routes
// 1. Retrieve all items
app.get("/items", async (req, res) => {
  try {
    const items = await Item.find().sort({ date: -1 });
    res.json(items);
  } catch (err) {
    res.status(500).send("Error retrieving items");
  }
});

// 2. Retrieve a single item
app.get("/items/:id", async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);
    if (!item) return res.status(404).send("Item not found");
    res.json(item);
  } catch (err) {
    res.status(500).send("Error retrieving item");
  }
});

// 3. Upload a new item
app.post("/upload", async (req, res) => {
  try {
    const { name, speaker, series } = req.body;
    const thumbnailFile = req.files.thumbnail;
    const audioFile = req.files.audioFile;

    // Upload thumbnail to Google Drive
    const thumbnailResponse = await drive.files.create({
      requestBody: { name: thumbnailFile.name, mimeType: thumbnailFile.mimetype },
      media: { mimeType: thumbnailFile.mimetype, body: fs.createReadStream(thumbnailFile.tempFilePath) },
    });

    // Upload audio file to Google Drive
    const audioResponse = await drive.files.create({
      requestBody: { name: audioFile.name, mimeType: audioFile.mimetype },
      media: { mimeType: audioFile.mimetype, body: fs.createReadStream(audioFile.tempFilePath) },
    });

    // Save item in MongoDB
    const newItem = new Item({
      name,
      thumbnail: thumbnailResponse.data.id,
      speaker,
      audioFile: audioResponse.data.id,
      series,
    });
    await newItem.save();
    res.status(201).json(newItem);
  } catch (err) {
    res.status(500).send("Error uploading item");
  }
});

// 4. Edit an item
app.put("/edit/:id", async (req, res) => {
  try {
    const { name, speaker, series } = req.body;
    const item = await Item.findById(req.params.id);
    if (!item) return res.status(404).send("Item not found");

    // Update fields
    if (name) item.name = name;
    if (speaker) item.speaker = speaker;
    if (series) item.series = series;

    // Handle thumbnail replacement
    if (req.files && req.files.thumbnail) {
      // Delete old thumbnail from Google Drive
      await drive.files.delete({ fileId: item.thumbnail });

      // Upload new thumbnail
      const thumbnailFile = req.files.thumbnail;
      const thumbnailResponse = await drive.files.create({
        requestBody: { name: thumbnailFile.name, mimeType: thumbnailFile.mimetype },
        media: { mimeType: thumbnailFile.mimetype, body: fs.createReadStream(thumbnailFile.tempFilePath) },
      });
      item.thumbnail = thumbnailResponse.data.id;
    }

    // Handle audio replacement
    if (req.files && req.files.audioFile) {
      // Delete old audio file from Google Drive
      await drive.files.delete({ fileId: item.audioFile });

      // Upload new audio file
      const audioFile = req.files.audioFile;
      const audioResponse = await drive.files.create({
        requestBody: { name: audioFile.name, mimeType: audioFile.mimetype },
        media: { mimeType: audioFile.mimetype, body: fs.createReadStream(audioFile.tempFilePath) },
      });
      item.audioFile = audioResponse.data.id;
    }

    await item.save();
    res.json(item);
  } catch (err) {
    res.status(500).send("Error editing item");
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
