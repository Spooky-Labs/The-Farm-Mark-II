/**
 * Multipart File Upload Middleware
 * Based on the original Spooky Labs implementation
 */

const Busboy = require('busboy');

/**
 * Parse multipart form data with file upload support
 * @param {Object} options - Configuration options
 * @param {number} options.fileSize - Max file size in bytes (default: 10MB)
 * @param {number} options.files - Max number of files (default: 5)
 */
function multipartFileUpload(options = {}) {
    const {
        fileSize = 10 * 1024 * 1024, // 10MB default
        files = 5
    } = options;

    return (req, res, next) => {
        if (!req.headers['content-type']?.startsWith('multipart/form-data')) {
            return next();
        }

        const busboy = Busboy({
            headers: req.headers,
            limits: {
                fileSize,
                files,
                fieldSize: 1024 * 1024, // 1MB for text fields
                fields: 20
            }
        });

        const fields = {};
        const files = {};

        busboy.on('field', (fieldname, val, info) => {
            fields[fieldname] = val;
        });

        busboy.on('file', (fieldname, file, info) => {
            const { filename, encoding, mimeType } = info;
            const chunks = [];

            file.on('data', (data) => {
                chunks.push(data);
            });

            file.on('end', () => {
                const buffer = Buffer.concat(chunks);

                files[fieldname] = {
                    fieldname,
                    originalname: filename,
                    encoding,
                    mimetype: mimeType,
                    buffer,
                    size: buffer.length
                };
            });

            file.on('error', (error) => {
                console.error('File upload error:', error);
            });
        });

        busboy.on('error', (error) => {
            console.error('Busboy error:', error);
            return res.status(400).json({
                error: 'Error parsing form data',
                details: error.message
            });
        });

        busboy.on('finish', () => {
            req.body = fields;
            req.files = files;
            next();
        });

        // Handle file size limit exceeded
        busboy.on('filesLimit', () => {
            return res.status(400).json({
                error: 'Too many files uploaded',
                limit: files
            });
        });

        busboy.on('fieldsLimit', () => {
            return res.status(400).json({
                error: 'Too many fields in form data'
            });
        });

        req.pipe(busboy);
    };
}

module.exports = multipartFileUpload;