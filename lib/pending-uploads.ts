export type PendingUpload = {
  id: string; file: File; fileName: string; profileId?: string;
  metadata: { subject: string; grade: string; sourceYear: string; sourceExamType: string; sourceRegion: string; sourceTextbook: string; sourceSchool: string };
};

async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("jianti-pending-uploads", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function persistPendingUploads(files: PendingUpload[]) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("files", "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error("浏览器保存任务失败"));
      transaction.onerror = () => reject(transaction.error);
      for (const file of files) transaction.objectStore("files").put(file);
    });
  } finally { db.close(); }
}

export async function readPendingUploads(): Promise<PendingUpload[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("files").objectStore("files").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function removePendingUpload(id: string) {
  const db = await database();
  try {
    await new Promise<void>((resolve,reject) => {
      const transaction = db.transaction("files", "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
      transaction.objectStore("files").delete(id);
    });
  } finally { db.close(); }
}
