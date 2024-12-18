// Import dependencies
const express = require('express');
const mongoose = require('mongoose');
const { google } = require('googleapis');
const multer = require('multer');
const bodyParser = require('body-parser');
const cors = require('cors');
const { Readable } = require('stream'); // Import Readable from 'stream'
const path = require("path");
const dotenv = require("dotenv");

// Load environment variables
dotenv.config();
// Initialize app
const app = express();
app.use(bodyParser.json());

// Enable CORS for all domains or specific domains
app.use(
  cors({
    origin: 'http://localhost:5173', // Allow requests from this origin (your frontend)
    methods: ['GET', 'POST', 'PUT', 'DELETE'], // Specify allowed methods if necessary
  })
);

// MongoDB connection
mongoose
  .connect(
    'mongodb+srv://barryjacob08:HrpYPLgajMiRJBgN@cluster0.ssafp.mongodb.net/yourDBW?retryWrites=true&w=majority',
    { useNewUrlParser: true, useUnifiedTopology: true }
  )
  .then(() => console.log('MongoDB connected successfully.'))
  .catch(err => console.error('MongoDB connection error:', err));

const Schema = mongoose.Schema;

// Define schema and model
const ItemSchema = new Schema({
  name: String,
  thumbnail: String, // Store only file ID
  date: Date,
  speaker: String,
  audioFile: String, // Store only file ID
  series: String,
});
const Item = mongoose.model('Item', ItemSchema);

// Google Drive setup
const auth = new google.auth.GoogleAuth({
  credentials: {
      type: process.env.GOOGLE_TYPE,
      project_id: process.env.GOOGLE_PROJECT_ID,
      private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), // Fix newline issue
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      client_id: process.env.GOOGLE_CLIENT_ID,
      auth_uri: process.env.GOOGLE_AUTH_URI,
      token_uri: process.env.GOOGLE_TOKEN_URI,
      auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_PROVIDER_CERT_URL,
      client_x509_cert_url: process.env.GOOGLE_CLIENT_CERT_URL,
  },
  scopes: ['https://www.googleapis.com/auth/drive'], // Adjust scopes as needed
});

const drive = google.drive({ version: 'v3', auth });

(async () => {
  try {
    const tokenInfo = await auth.getAccessToken();
    console.log('Connected to Google Drive successfully. Token obtained:', tokenInfo);
  } catch (err) {
    console.error('Google Drive connection error:', err);
  }
})();

// Multer setup with memory storage
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Helper function to upload files to Google Drive
async function uploadToDrive(file) {
  try {
    const fileMetadata = { name: file.originalname };

    // Convert Buffer to Readable stream
    const bufferStream = new Readable();
    bufferStream.push(file.buffer);
    bufferStream.push(null); // Signal end of stream

    const media = { mimeType: file.mimetype, body: bufferStream };

    // Upload the file to Google Drive
    const response = await drive.files.create({
      resource: fileMetadata,
      media,
      fields: 'id', // Only retrieve the file ID
    });

    const fileId = response.data.id;

    // Make the uploaded file publicly accessible
    await drive.permissions.create({
      fileId: fileId,
      requestBody: {
        role: 'reader', // 'reader' allows anyone to view the file
        type: 'anyone', // 'anyone' means anyone on the internet
      },
    });

    return fileId; // Return the file ID
  } catch (err) {
    console.error('Error uploading file to Google Drive:', err);
    throw err;
  }
}

// Helper function to delete files from Google Drive
async function deleteFromDrive(fileUrl) {
  try {
    // Ensure fileUrl exists and contains an ID
    if (fileUrl && fileUrl.match(/id=([^&]+)/)) {
      const fileId = fileUrl.match(/id=([^&]+)/)[1];
      console.log('Attempting to delete file with ID:', fileId);
      await drive.files.delete({ fileId });
      console.log('File deleted from Google Drive:', fileId);
    } else {
      console.log('No valid file URL provided, skipping deletion.');
    }
  } catch (err) {
    console.error('Error deleting file from Google Drive:', err);
    throw err;
  }
}

// API Endpoints

// 1. Retrieve all items (without converting to URLs)
app.get('/items', async (req, res) => {
  try {
    const items = await Item.find().sort({ date: -1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Retrieve a single item (without converting to URLs)
app.get('/items/:id', async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Upload new entry
app.post('/upload', upload.fields([{ name: 'thumbnail' }, { name: 'audioFile' }]), async (req, res) => {
  try {
    // Upload files and get only the file IDs
    const thumbnailFileId = req.files.thumbnail ? await uploadToDrive(req.files.thumbnail[0]) : null;
    const audioFileFileId = req.files.audioFile ? await uploadToDrive(req.files.audioFile[0]) : null;

    const newItem = new Item({
      name: req.body.name,
      thumbnail: thumbnailFileId, // Store file ID, not the full URL
      date: new Date(req.body.date),
      speaker: req.body.speaker,
      audioFile: audioFileFileId, // Store file ID, not the full URL
      series: req.body.series,
    });

    await newItem.save();
    res.json(newItem);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Edit an entry
app.put('/edit/:id', upload.fields([{ name: 'thumbnail' }, { name: 'audioFile' }]), async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    if (req.body.name) item.name = req.body.name;
    if (req.body.date) item.date = new Date(req.body.date);
    if (req.body.speaker) item.speaker = req.body.speaker;
    if (req.body.series) item.series = req.body.series;

    if (req.files && req.files.thumbnail) {
      // Delete previous thumbnail file if exists
      if (item.thumbnail) await deleteFromDrive(item.thumbnail);
      // Upload new thumbnail and store its file ID
      item.thumbnail = await uploadToDrive(req.files.thumbnail[0]);
    }

    if (req.files && req.files.audioFile) {
      // Delete previous audio file if exists
      if (item.audioFile) await deleteFromDrive(item.audioFile);
      // Upload new audio file and store its file ID
      item.audioFile = await uploadToDrive(req.files.audioFile[0]);
    }

    await item.save();
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Delete an item
app.delete('/items/:id', async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    // Delete associated files from Google Drive if URLs are valid
    if (item.thumbnail) await deleteFromDrive(item.thumbnail);
    if (item.audioFile) await deleteFromDrive(item.audioFile);

    // Delete the item from MongoDB
    await Item.findByIdAndDelete(req.params.id);
    res.json({ message: 'Item deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve the static files from the React build
app.use(express.static(path.join(__dirname, "dist")));

// Catch-all route to serve React's index.html
app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "dist", "index.html"));
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
