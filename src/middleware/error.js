function notFound(req, res) {
  res.status(404).json({ error: 'Not found' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  if (err.code === '23505') return res.status(409).json({ error: 'That record already exists' });
  if (err.code === '23503') return res.status(400).json({ error: 'A referenced record does not exist' });
  if (err.code === '22P02' || err.code === '22007' || err.code === '22008') return res.status(400).json({ error: 'Invalid value in request' });
  if (err.name === 'MulterError') return res.status(400).json({ error: `Upload error: ${err.message}` });
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}

module.exports = { notFound, errorHandler };
