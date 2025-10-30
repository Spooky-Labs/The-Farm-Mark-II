// middleware.js
// From: https://www.mikesukmanowsky.com/blog/firebase-file-and-image-uploads

const Busboy = require('busboy');

exports.multipartFileUpload = function (req, res, next) {
    console.log("Started Parsing Files")
    const busboy = Busboy({
        headers: req.headers,
        limits: {
            fileSize: 10 * 1024 * 1024, // 10MB limit
        }
    });

    const fields = {};
    const files = [];
    const filePromises = [];

    busboy.on("field", (key, value) => {
        fields[key] = value;
    });

    busboy.on("file", (fieldname, file, { filename, encoding, mimeType }) => {
        console.log(`Handling file upload ${fieldname}: ${filename}`);

        // Create buffer collection instead of writing to disk
        const chunks = [];

        // Collect file data chunks
        file.on('data', (chunk) => {
            chunks.push(chunk);
        });

        // Create a promise for when this file is fully processed
        const filePromise = new Promise((resolve, reject) => {
            file.on('end', () => {
                // Concatenate chunks into a single buffer
                const buffer = Buffer.concat(chunks);
                const size = buffer.length;

                console.log(`${filename} is ${size} bytes`);

                files.push({
                    fieldname,
                    originalname: filename,
                    encoding,
                    mimetype: mimeType,
                    buffer,
                    size,
                });

                resolve();
            });

            file.on('error', (err) => {
                reject(err);
            });
        });

        filePromises.push(filePromise);
    });

    busboy.on("finish", () => {
        Promise.all(filePromises)
            .then(() => {
                req.body = fields;
                req.files = files;
                next();
            })
            .catch(next);
    });

    busboy.on("error", next);
    
    busboy.end(req.rawBody);
};