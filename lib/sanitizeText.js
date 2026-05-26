function createPlainTextSanitizer(DOMPurify) {
  return function sanitizePlainText(value, maxLen = 500) {
    const stripped = DOMPurify.sanitize(String(value || ''), { ALLOWED_TAGS: [] });
    return stripped.trim().slice(0, maxLen);
  };
}

module.exports = { createPlainTextSanitizer };
