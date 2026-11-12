let database;

function removeEntries(db, prefix, obsolete) {
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction('images', 'readwrite');
      const range = IDBKeyRange.bound(prefix, prefix + '\uffff');
      const request = transaction.objectStore('images').openCursor(range);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (obsolete(cursor.key, cursor.value)) cursor.delete();
        cursor.continue();
      };
      transaction.oncomplete = transaction.onabort = () => resolve();
    } catch { resolve(); }
  });
}

function openCache() {
  return database ??= new Promise((resolve) => {
    try {
      const open = indexedDB.open('tcg-card-images', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('images');
      open.onsuccess = async () => {
        const db = open.result;
        // The original cache used a new key for every pack revision.
        await removeEntries(db, 'generated:', () => true);
        resolve(db);
      };
      open.onerror = open.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

export function generatedImageRevision(renderer, recipe, scan = '') {
  return `${renderer}:${recipe}:${scan}`;
}

export async function pruneGeneratedCache(locale, pack) {
  const db = await openCache();
  if (!db || !pack.versions || !pack.rendererRevision) return;
  const prefix = `card:${locale}:`;
  await removeEntries(db, prefix, (key, record) => {
    const version = pack.versions[key.slice(prefix.length)];
    if (!version || typeof record?.revision !== 'string') return true;
    const recipeRevision = generatedImageRevision(pack.rendererRevision, version.recipe);
    return version.scan ? record.revision !== recipeRevision + version.scan.hash :
      !record.revision.startsWith(recipeRevision);
  });
}

export async function cachedCardImage(key, load, revision) {
  const db = await openCache();
  if (db) {
    const stored = await new Promise((resolve) => {
      try {
        const store = db.transaction('images', revision ? 'readwrite' : 'readonly').objectStore('images');
        const request = store.get(key);
        request.onsuccess = () => {
          const record = request.result;
          if (!revision) return resolve(record);
          if (record?.revision === revision) return resolve(record.blob);
          if (record !== undefined) store.delete(key);
          resolve();
        };
        request.onerror = () => resolve();
      } catch { resolve(); }
    });
    if (stored instanceof Blob && stored.size) return stored;
  }
  const blob = await load();
  try { db?.transaction('images', 'readwrite').objectStore('images').put(revision ? { revision, blob } : blob, key); }
  catch { /* A full or unavailable cache does not prevent displaying the image. */ }
  return blob;
}
