// Keep filename evidence separate from model classification: a model may omit fields.
const numeral = "[0-9零〇一二三四五六七八九十百两]+";
const gap = "[\\s_（()）【】\\[\\]·.、-]*";

export function schoolPaperYear(original: string): string {
  const source = original.replace(/^.*?更新[_\s]+/, "");
  const cohort = source.match(/(?<!\d)(\d{4})(?:[-_—–～至](\d{4}))?[_\s]*届/);
  if (cohort) return cohort[2] || cohort[1];
  return source.match(/(?<!\d)\d{4}[-_—–～至](\d{4})(?!\d)/)?.[1]
    ?? source.match(/(?<!\d)(\d{4})(?!\d)/)?.[1] ?? "";
}

function number(text: string): string {
  if (/^\d+$/.test(text)) return String(Number(text));
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  let total = 0, digit = 0;
  for (const char of text) {
    if (char === "十" || char === "百") { total += (digit || 1) * (char === "十" ? 10 : 100); digit = 0; }
    else if (digits[char] !== undefined) digit = digits[char];
    else return text;
  }
  return String(total + digit);
}

export function schoolPaperDetails(original: string) {
  const source = original.normalize("NFKC").replace(/\.pdf$/i, "");
  const gradeMatch = source.match(/([高初])(?:中)?([一二三123])(?:年级)?/) ?? source.match(/([一二三四五六七八九1-9])年级/);
  const grade = !gradeMatch ? "" : gradeMatch.length === 3
    ? gradeMatch[1] + ({ "1": "一", "2": "二", "3": "三" }[gradeMatch[2]] ?? gradeMatch[2])
    : gradeMatch[0];
  // Only explicit semester/season evidence; an exam number is not a semester.
  const semesterMatch = source.match(/(?:第?一|上)学期|(?:第?二|下)学期|[高初](?:中)?[一二三123](?:年级)?[\s_(]*([上下])|\d{4}年([春秋])/);
  const semester = !semesterMatch ? "" : /一学期|上学期|上|秋/.test(semesterMatch[0]) ? "上" : "下";
  const monthSource = source.replace(/[高初](?:中)?[一二三123](?:年级)?/g, "");
  const monthMatch = monthSource.match(/(?:^|[^\d零一二三四五六七八九十第])([01]?\d|十一|十二|十|[一二三四五六七八九]|元)月份?/);
  const dateMatch = source.match(/(?<!\d)(?:\d{4}[.年_-])?(0?[1-9]|1[0-2])[.](0?[1-9]|[12]\d|3[01])(?:[^\d]|$)/);
  const yearMonth = source.match(/(?<!\d)\d{4}[.](0?[1-9]|1[0-2])(?![\d.])/);
  const monthNumber = monthMatch ? monthMatch[1] === "元" ? "1" : number(monthMatch[1]) : dateMatch ? String(Number(dateMatch[1])) : yearMonth ? String(Number(yearMonth[1])) : "";
  const month = monthNumber && Number(monthNumber) >= 1 && Number(monthNumber) <= 12 ? monthNumber + "月" : "";
  const date = dateMatch ? `${Number(dateMatch[1])}.${Number(dateMatch[2])}` : "";
  let exam = "", sequence = "";
  const weekly = source.match(/周爽|周考|周测|周练|周[三六末]练习?|每周测试|第[零〇一二三四五六七八九十百\d]+周(?:测试|检测|高[一二三]数学检测)/);
  if (/期中/.test(source)) exam = "期中";
  else if (/期末|期终/.test(source)) exam = "期末";
  else if (/开学|入学考/.test(source)) exam = "开学考";
  else if (/月考|月度考试|月度检测/.test(source)) exam = "月考";
  else if (weekly) exam = weekly[0].startsWith("周爽") ? "周爽" : /周考|每周测试/.test(weekly[0]) ? "周考" : /练/.test(weekly[0]) ? "周练" : "周测";
  else if (/模拟/.test(source) && !/三模(?!拟)/.test(source)) exam = "模拟卷";
  else if (!/三模(?!拟)|竞赛|高考真题|中考真题|复习|练习册|同步练习/.test(source)) {
    exam = source.match(/联考|联合调研|摸底(?:考试)?|初态(?:考试|测试)|零次考试|适应性(?:考试|练习)|毕业考试|考前测试|阶段(?:性|学习)?(?:质量)?(?:测试|检测|反馈)|(?:教学)?质量(?:检测|调研|抽测|监控)|(?:综合素养|核心素养|学科素养)(?:调研|测试|检测)|自我定位检测|线上自测|教学评估|卓越(?:考|测试)|拓展考试|综合(?:测试)?(?:试卷|卷)|热身(?:考试)?|质检|阶考|测验|调研(?:检测)?|评估|测试(?:卷)?|检测(?:卷)?|预测|押题卷|压轴卷/)?.[0] ?? "";
  }
  if (exam === "月考") sequence = source.match(new RegExp(`第(${numeral})次${gap}月考`))?.[1] ?? "";
  if (["周爽", "周考", "周测", "周练", "开学考"].includes(exam) && weekly) {
    sequence = source.match(new RegExp(`第(${numeral})(?:周|次${gap}(?:周爽|周考|周测|周练))`))?.[1]
      ?? source.match(new RegExp(`(?:周爽|周考|周测|周练)(?:习|测试)?(?:数学|试卷|卷|试题)*${gap}(${numeral}(?:和${numeral})?)(?![\\d.月年届])`))?.[1] ?? "";
  }
  if (exam === "模拟卷") sequence = source.match(new RegExp(`第(${numeral})次模拟`))?.[1]
    ?? source.match(new RegExp(`模拟(?:冲刺|考试|试)?(?:数学)?(?:试卷|卷|试题|练习)?${gap}(${numeral})(?![\\d.月年届])`))?.[1] ?? "";
  const standard = ["期中", "期末", "月考", "开学考", "周爽", "周考", "周测", "周练", "模拟卷"].includes(exam);
  if (exam && !standard) sequence = source.match(new RegExp(`第(${numeral})次${gap}(?:${exam})`))?.[1]
    ?? source.match(new RegExp(`${exam}(?:数学)?(?:试卷|试题|卷)?${gap}(${numeral})(?![\\d.月年届])`))?.[1] ?? "";
  sequence = sequence.split("和").filter(Boolean).map(number).join("和");
  if (sequence.split("和").some(part => Number(part) >= 1000)) sequence = ""; // Never treat a year as an exam number.
  const weeklyLabel = weekly && /^周[三六末]/.test(weekly[0]) ? weekly[0] : /模拟周练/.test(source) && exam === "周练" ? "模拟周练" : exam;
  const label = exam === "月考" ? `${month}${sequence ? `第${sequence}次` : ""}月考`
    : exam === "开学考" ? `${month}开学考${sequence ? `（${weekly?.[0]}${sequence}）` : ""}`
    : ["期中", "期末"].includes(exam) ? exam : exam ? `${month}${weeklyLabel}${sequence}${date ? `（${date}）` : ""}` : "";
  const qualifiers = [...new Set(source.match(/无答案|答案不全|简略答案|简答|原卷[版板]|解析[版班]|教师版|学生版|含解析|含答案|有答案|答案|图片版|扫描版/g) ?? [])];
  const stream = source.match(/文理(?:科)?|文科|理科|[_(](文|理)[_)]/)?.[0];
  if (stream) qualifiers.unshift(stream.replace(/[_()]/g, "").replace(/^文$/, "文科").replace(/^理$/, "理科"));
  return { grade, semester, month, sequence, exam, label, qualifiers };
}
