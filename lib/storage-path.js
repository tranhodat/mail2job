// Keep repository paths short on Windows; display/download names stay in the index.
module.exports = function storedFileName(name, id = 'file') {
  const match = String(name || '').match(/\.([a-z0-9]{1,10})$/i);
  return id + (match ? '.' + match[1].toLowerCase() : '');
};
