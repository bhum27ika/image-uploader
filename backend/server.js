require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { v2: cloudinary } = require("cloudinary");
const path = require("path");
const { Readable } = require("stream");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Cloudinary Config ────────────────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Serve frontend static files
app.use(express.static(path.join(__dirname, "../frontend")));

// ─── Multer — store file in memory (no disk writes) ──────────────────────────
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB max
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed (JPG, PNG, GIF, WEBP, SVG)"));
    }
  },
});

// ─── Helper: buffer → Cloudinary upload stream ───────────────────────────────
function uploadToCloudinary(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });

    const readable = new Readable();
    readable.push(buffer);
    readable.push(null);
    readable.pipe(uploadStream);
  });
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    cloudinary: !!process.env.CLOUDINARY_CLOUD_NAME,
    message: "Server is running",
  });
});

// Upload image
app.post("/api/upload", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file provided" });
    }

    const result = await uploadToCloudinary(req.file.buffer, {
      folder: "uploads",             // organises into a folder in Cloudinary
      resource_type: "image",
      use_filename: true,
      unique_filename: true,
    });

    res.json({
      success: true,
      url: result.secure_url,
      public_id: result.public_id,
      format: result.format,
      size: result.bytes,
      width: result.width,
      height: result.height,
      created_at: result.created_at,
    });

  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: err.message || "Upload failed" });
  }
});

// Get all uploaded images
app.get("/api/images", async (req, res) => {
  try {
    const result = await cloudinary.api.resources({
      type: "upload",
      prefix: "uploads/",
      max_results: 50,
      resource_type: "image",
    });

    const images = result.resources.map((r) => ({
      public_id: r.public_id,
      url: r.secure_url,
      format: r.format,
      size: r.bytes,
      width: r.width,
      height: r.height,
      created_at: r.created_at,
    }));

    res.json({ success: true, images });
  } catch (err) {
    console.error("List error:", err);
    res.status(500).json({ error: err.message || "Failed to fetch images" });
  }
});

// Delete image by public_id
app.delete("/api/images/:public_id", async (req, res) => {
  try {
    const public_id = req.params.public_id;
    const result = await cloudinary.uploader.destroy(public_id);

    if (result.result === "ok") {
      res.json({ success: true, message: "Image deleted" });
    } else {
      res.status(404).json({ error: "Image not found or already deleted" });
    }
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).json({ error: err.message || "Delete failed" });
  }
});

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "File too large. Maximum size is 20MB." });
    }
  }
  res.status(400).json({ error: err.message || "Something went wrong" });
});

// ─── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅ Server running at http://localhost:${PORT}`);
  console.log(`📁 Serving frontend from: ../frontend/`);
  console.log(`☁️  Cloudinary cloud: ${process.env.CLOUDINARY_CLOUD_NAME || "⚠️  NOT SET"}\n`);
});
