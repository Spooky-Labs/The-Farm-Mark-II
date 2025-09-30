/**
 * Multipart File Upload Middleware
 * Handles file uploads using busboy, collecting files and form data
 */

const Busboy = require('busboy');

/**
 * Middleware to handle multipart file uploads
 * Parses incoming files and form data, stores files in memory as buffers
 */
function multipartFileUpload(req, res, next) {
    if (req.method !== 'POST') {
        return next();
    }

    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('multipart/form-data')) {
        return next();
    }

    const busboy = Busboy({
        headers: req.headers,
        limits: {
            fileSize: 10 * 1024 * 1024, // 10MB limit
            files: 20 // Maximum 20 files
        }
    });

    req.files = [];
    req.body = req.body || {};

    busboy.on('file', (fieldname, file, info) => {
        const { filename, encoding, mimeType } = info;

        console.log(`File upload started: ${filename} (${mimeType})`);

        const buffers = [];
        let totalSize = 0;

        file.on('data', (chunk) => {
            buffers.push(chunk);
            totalSize += chunk.length;
        });

        file.on('end', () => {
            const buffer = Buffer.concat(buffers);

            req.files.push({
                fieldname: fieldname,
                originalname: filename,
                encoding: encoding,
                mimetype: mimeType,
                buffer: buffer,
                size: totalSize
            });

            console.log(`File upload completed: ${filename} (${totalSize} bytes)`);
        });

        file.on('error', (error) => {
            console.error(`File upload error for ${filename}:`, error);
        });
    });

    busboy.on('field', (fieldname, value) => {
        req.body[fieldname] = value;
    });

    busboy.on('finish', () => {
        console.log(`Upload finished. Received ${req.files.length} files`);
        next();
    });

    busboy.on('error', (error) => {
        console.error('Busboy error:', error);
        res.status(400).json({
            error: 'File upload error',
            message: error.message
        });
    });

    req.pipe(busboy);
}

module.exports = multipartFileUpload;