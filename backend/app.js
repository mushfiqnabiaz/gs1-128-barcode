const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const archiver = require("archiver");
const csv = require("csv-parser");
const bwipjs = require("bwip-js");

const app = express();
const PORT = 3000;

// Middleware for file uploads
const upload = multer({ dest: "uploads/" });

// SQLite Database Setup
const dbPath = path.join(__dirname, "stats.db");
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error("Error connecting to SQLite:", err.message);
    else console.log("Connected to SQLite database.");
});

// Initialize stats database
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS stats (
                                             id INTEGER PRIMARY KEY AUTOINCREMENT,
                                             today INTEGER DEFAULT 0,
                                             thisWeek INTEGER DEFAULT 0,
                                             thisMonth INTEGER DEFAULT 0,
                                             thisYear INTEGER DEFAULT 0,
                                             lifetime INTEGER DEFAULT 0,
                                             lastReset DATE DEFAULT CURRENT_DATE
        )
    `);

    db.get("SELECT COUNT(*) AS count FROM stats", (err, row) => {
        if (err) console.error("Error querying stats table:", err.message);
        else if (row.count === 0) {
            db.run("INSERT INTO stats (today, thisWeek, thisMonth, thisYear, lifetime) VALUES (0, 0, 0, 0, 0)");
        }
    });
});

// API: Get Stats
app.get("/api/stats", (req, res) => {
    db.get("SELECT today, thisWeek, thisMonth, thisYear, lifetime FROM stats", (err, row) => {
        if (err) {
            console.error("Error fetching stats:", err.message);
            return res.status(500).send("Failed to fetch stats.");
        }
        res.json(row);
    });
});

// API: Upload CSV and Generate Barcodes
app.post("/upload", upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded.");

    const inputCsvPath = req.file.path;
    const outputDir = path.join(__dirname, "barcodes-output");

    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

    const rows = [];

    fs.createReadStream(inputCsvPath)
        .pipe(csv())
        .on("data", (row) => rows.push(row))
        .on("end", async () => {
            try {
                let barcodeCount = 0;

                for (const [index, row] of rows.entries()) {
                    const {
                        GS_Prompt,
                        GS_Separator_1,
                        Material_Number,
                        GS_Separator_2,
                        Carton_number,
                        GS_Separator_3,
                        Batch_Number,
                    } = row;

                    // Ensure Carton_number has leading zeros
                    const paddedCartonNumber = Carton_number.padStart(4, "0");

                    // Generate scanner-readable and human-readable formats
                    const scannerReadable = `${GS_Prompt}${GS_Separator_1}${Material_Number}|${GS_Separator_2}${paddedCartonNumber}|${GS_Separator_3}${Batch_Number}`;
                    const humanReadable = `(${GS_Separator_1}) ${Material_Number} (${GS_Separator_2}) ${paddedCartonNumber} (${GS_Separator_3}) ${Batch_Number}`;

                    try {
                        const barcodeBuffer = await bwipjs.toBuffer({
                            bcid: "code128", // Barcode type
                            text: scannerReadable, // Data to encode
                            scale: 2, // Adjust scale for proper width
                            height: 20, // Adjust height for better readability
                            includetext: false, // No text included in the barcode
                        });

                        const outputFileName = `carton_${paddedCartonNumber}_final.png`;
                        const outputPath = path.join(outputDir, outputFileName);

                        // Draw barcode and human-readable text
                        const { createCanvas, loadImage } = require("canvas");
                        const barcodeImage = await loadImage(barcodeBuffer);
                        const canvas = createCanvas(barcodeImage.width, barcodeImage.height + 40);
                        const ctx = canvas.getContext("2d");

                        // Fill background with white
                        ctx.fillStyle = "white";
                        ctx.fillRect(0, 0, canvas.width, canvas.height);

                        // Draw the barcode image
                        ctx.drawImage(barcodeImage, 0, 0);

                        // Draw human-readable text underneath
                        ctx.font = "bold 22px Arial"; // Adjust font size
                        ctx.fillStyle = "black";
                        ctx.textAlign = "center";
                        ctx.fillText(humanReadable, canvas.width / 2, barcodeImage.height + 30); // Adjust placement

                        const stream = canvas.createPNGStream();
                        const out = fs.createWriteStream(outputPath);
                        stream.pipe(out);

                        barcodeCount++;
                    } catch (err) {
                        console.error(`Error generating barcode for row ${index + 1}:`, err);
                    }
                }

                // Update stats in database
                db.run(
                    `UPDATE stats
                     SET today = today + ?,
                         thisWeek = thisWeek + ?,
                         thisMonth = thisMonth + ?,
                         thisYear = thisYear + ?,
                         lifetime = lifetime + ?`,
                    [barcodeCount, barcodeCount, barcodeCount, barcodeCount, barcodeCount],
                    (err) => {
                        if (err) console.error("Error updating stats:", err.message);
                    }
                );

                // Create ZIP file of barcodes
                const zipPath = path.join(__dirname, "barcodes.zip");
                const outputZip = fs.createWriteStream(zipPath);
                const archive = archiver("zip", { zlib: { level: 9 } });

                archive.on("error", (err) => {
                    console.error("Error creating ZIP file:", err);
                    res.status(500).send("Error creating ZIP file.");
                });

                outputZip.on("close", () => {
                    res.download(zipPath, "barcodes.zip", (err) => {
                        if (err) console.error("Error sending ZIP file:", err);
                        fs.unlinkSync(inputCsvPath);
                        fs.rmSync(outputDir, { recursive: true, force: true });
                        fs.unlinkSync(zipPath);
                    });
                });

                archive.pipe(outputZip);
                archive.directory(outputDir, false);
                await archive.finalize();
            } catch (err) {
                console.error("Error processing CSV:", err);
                res.status(500).send("Error generating barcodes.");
            }
        });
});

// Serve static frontend files
app.use(express.static(path.join(__dirname, "../frontend")));

// Fallback route for unknown paths
app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "../frontend", "index.html"));
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
