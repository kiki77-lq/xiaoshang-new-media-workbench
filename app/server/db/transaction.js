export function inTransaction(db, execute) {
  if (db.isTransaction) return execute();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = execute();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* transaction may already be closed */ }
    throw error;
  }
}
