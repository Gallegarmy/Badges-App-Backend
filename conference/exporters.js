function toCsvCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[\",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildCsv(rows) {
  return rows.map((row) => row.map((value) => toCsvCell(value)).join(",")).join("\n");
}

export function buildEntriesCsv(entries) {
  const normalized = entries.map((entry) => ({
    user_id: entry.user_id,
    email: entry.email || "",
    username: entry.username,
    required_visited: Number(entry.required_visited || 0),
    required_total: Number(entry.required_total || 0),
    optional_entries: Number(entry.optional_entries || 0),
    raffle_entries: Number(entry.raffle_entries || 0),
  }));

  const totalEntries = normalized.reduce((acc, row) => acc + row.raffle_entries, 0);

  const rows = [
    [
      "user_id",
      "email",
      "username",
      "required_visited",
      "required_total",
      "optional_entries",
      "raffle_entries",
    ],
    ...normalized.map((row) => {
      return [
        row.user_id,
        row.email,
        row.username,
        row.required_visited,
        row.required_total,
        row.optional_entries,
        row.raffle_entries,
      ];
    }),
  ];

  return `${buildCsv(rows)}\n`;
}
