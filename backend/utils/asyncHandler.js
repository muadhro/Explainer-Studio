// Express 4 doesn't forward rejected promises from async route handlers to
// error middleware on its own — an unhandled rejection just hangs the
// request. Wrap every async handler with this so DB/network errors become a
// proper 500 response instead of a silent hang.
module.exports = function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
