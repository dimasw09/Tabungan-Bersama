export type Identified = { id: string };

export function upsertById<T extends Identified>(rows: T[], next: T, sort?: (a: T, b: T) => number): T[] {
  const index = rows.findIndex((row) => row.id === next.id);
  const updated = index === -1 ? [...rows, next] : rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...next } : row);
  return sort ? updated.sort(sort) : updated;
}

export function removeById<T extends Identified>(rows: T[], id: string): T[] {
  return rows.filter((row) => row.id !== id);
}
