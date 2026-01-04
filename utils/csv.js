function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toCsv(rows) {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n');
}

module.exports = {
  toCsv
};
