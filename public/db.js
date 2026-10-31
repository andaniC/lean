// Tiny IndexedDB wrapper: "entries" (food logs), "weights" (weigh-ins), "water" (ml per day) and "workouts".
import { STORAGE } from "./config.js";

const DB_NAME = STORAGE;
const DB_VERSION = 3;
let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("entries")) db.createObjectStore("entries", { keyPath: "id" });
      if (!db.objectStoreNames.contains("weights")) db.createObjectStore("weights", { keyPath: "id" });
      if (!db.objectStoreNames.contains("water")) db.createObjectStore("water", { keyPath: "date" });
      if (!db.objectStoreNames.contains("workouts")) db.createObjectStore("workouts", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const getAll = (store) => run(store, "readonly", (s) => s.getAll());
export const put = (store, value) => run(store, "readwrite", (s) => s.put(value));
export const remove = (store, id) => run(store, "readwrite", (s) => s.delete(id));
export const clear = (store) => run(store, "readwrite", (s) => s.clear());
export const putMany = (store, values) =>
  run(store, "readwrite", (s) => {
    values.forEach((v) => s.put(v));
  });
