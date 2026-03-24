const express = require('express');
const multer = require('multer');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' });

// Serve a simple HTML form
app.get('/', (req, res) => {
    res.send(`
        <h2>Upload M3U File for Automated Processing</h2>
        <form action="/process" method="POST" enctype="multipart/form-data">
            <input type="file" name="m3uFile" accept=".m3u,.m3u8" required />
            <button type="submit">Process & Download</button>
        </form>
        <p><em>Note: Processing may take some time depending on the number of links.</em></p>
    `);
});

// Helper function to extract .m3u8 using Puppeteer
async function fetchM3u8Url(playerUrl) {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    
    return new Promise(async (resolve) => {
        let foundUrl = null;
        
        await page.setRequestInterception(true);
        page.on('request', request => {
            const url = request.url();
            // Detect the actual m3u8 stream from network requests
            if (url.includes('.m3u8') && !foundUrl) {
                foundUrl = url;
                resolve(foundUrl); // Resolve immediately to save time
            }
            request.continue();
        });

        // Timeout fallback (15 seconds)
        setTimeout(() => {
            if (!foundUrl) resolve(null);
        }, 15000);

        try {
            await page.goto(playerUrl, { waitUntil: 'domcontentloaded' });
        } catch (error) {
            console.log(`Failed to load: ${playerUrl}`);
        }
        
        // Wait briefly just in case, then close
        await new Promise(r => setTimeout(r, 2000));
        await browser.close();
    });
}

// Process the uploaded file
app.post('/process', upload.single('m3uFile'), async (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded.');

    try {
        const filePath = req.file.path;
        let fileContent = fs.readFileSync(filePath, 'utf-8');
        
        // Regex to find all player links (adjust regex based on your exact URLs)
        const playerRegex = /(https?:\/\/tv\.roarzone\.info\/player\.php\?stream=[^\s]+)/g;
        const links = fileContent.match(playerRegex) || [];
        
        // Remove duplicates to minimize Puppeteer tasks
        const uniqueLinks = [...new Set(links)];
        console.log(`Found ${uniqueLinks.length} unique player links.`);

        for (const playerUrl of uniqueLinks) {
            console.log(`Processing: ${playerUrl}`);
            const m3u8Url = await fetchM3u8Url(playerUrl);
            
            if (m3u8Url) {
                console.log(`Found m3u8: ${m3u8Url}`);
                // Replace globally in the file content
                fileContent = fileContent.split(playerUrl).join(m3u8Url);
            } else {
                console.log(`Could not extract m3u8 for: ${playerUrl}`);
            }
        }

        // Save new file and send to user
        const newFilePath = path.join(__dirname, 'uploads', `processed_${req.file.originalname}`);
        fs.writeFileSync(newFilePath, fileContent);
        
        res.download(newFilePath, `Updated_${req.file.originalname}`, () => {
            // Clean up files after download
            fs.unlinkSync(filePath);
            fs.unlinkSync(newFilePath);
        });

    } catch (err) {
        console.error(err);
        res.status(500).send('An error occurred during processing.');
    }
});

app.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
});
