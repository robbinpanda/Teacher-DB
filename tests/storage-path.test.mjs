import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { resolveFileStorageKey } from "../lib/storage-path.ts";

test("相对和绝对数据目录解析到同一个文件位置", () => {
  for (const directory of ["data", "./tmp/custom-data", path.resolve("tmp/custom-data")]) {
    assert.equal(resolveFileStorageKey(directory, "documents/doc/page.jpg"), path.resolve(directory, "files/documents/doc/page.jpg"));
    assert.equal(resolveFileStorageKey(directory, "documents\\doc\\page.jpg"), path.resolve(directory, "files/documents/doc/page.jpg"));
  }
});

test("相对数据目录仍拒绝目录穿越和空键", () => {
  for (const key of ["", "/", "../secret", "documents/../../secret", "documents\\..\\secret", "./secret"]) {
    assert.throws(() => resolveFileStorageKey("./data", key), /非法文件存储路径|文件路径越界/);
  }
});
