export type RosterRow = { studentNo: string; name: string; seatNumber: string | null };

const numberHeaders = new Set(["学号", "编号", "学生编号", "studentno", "student_no", "id"]);
const nameHeaders = new Set(["姓名", "学生姓名", "name"]);
const seatHeaders = new Set(["座号", "座位号", "seat", "seatnumber", "seat_number"]);

function parseCsvLines(source: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(field); field = ""; }
    else if (character === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (character !== "\r") field += character;
  }
  if (quoted) throw new Error("CSV 中存在未闭合的引号");
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((values) => values.some((value) => value.trim()));
}

function normalizedHeader(value: string) {
  return value.trim().toLocaleLowerCase("zh-CN").replaceAll(" ", "");
}

export function parseRosterCsv(source: string, limit = 2000): RosterRow[] {
  const rows = parseCsvLines(source.replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new Error("CSV 至少需要表头和一名学生");
  const headers = rows[0].map(normalizedHeader);
  const numberIndex = headers.findIndex((value) => numberHeaders.has(value));
  const nameIndex = headers.findIndex((value) => nameHeaders.has(value));
  const seatIndex = headers.findIndex((value) => seatHeaders.has(value));
  if (numberIndex < 0 || nameIndex < 0) throw new Error("CSV 表头必须包含“学号”和“姓名”");
  if (rows.length - 1 > limit) throw new Error(`一次最多导入 ${limit} 名学生`);
  const seen = new Set<string>();
  return rows.slice(1).map((values, index) => {
    const studentNo = (values[numberIndex] ?? "").trim();
    const name = (values[nameIndex] ?? "").trim();
    const seatNumber = seatIndex < 0 ? null : (values[seatIndex] ?? "").trim() || null;
    if (!studentNo || !name) throw new Error(`第 ${index + 2} 行缺少学号或姓名`);
    if (studentNo.length > 40 || name.length > 40 || (seatNumber?.length ?? 0) > 20) throw new Error(`第 ${index + 2} 行内容过长`);
    if (/[\u0000-\u001f]/.test(`${studentNo}${name}${seatNumber ?? ""}`)) throw new Error(`第 ${index + 2} 行包含无效字符`);
    if (seen.has(studentNo)) throw new Error(`CSV 中学号“${studentNo}”重复`);
    seen.add(studentNo);
    return { studentNo, name, seatNumber };
  });
}
