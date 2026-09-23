export function normalizeCredentials(raw: string): string {
  let value = raw.trim().replace(/^\uFEFF/, "");
  value = value.replace(/^["']+|["']+$/g, "");
  value = value.replace(/^authorization:\s*/i, "").replace(/^key\s+/i, "");
  value = value.replace(/：/g, ":");
  value = value.replace(/\s+/g, " ").trim();
  if (!value.includes(":")) {
    const parts = value.split(" ").filter(Boolean);
    if (parts.length === 2) value = `${parts[0]}:${parts[1]}`;
  }
  return value;
}

export function credentialProblem(value: string): string | null {
  if (!value) return "API 키를 넣어 주세요.";
  const sep = value.indexOf(":");
  if (sep <= 0 || sep === value.length - 1) {
    return "넣은 키에 콜론(:)이 없습니다. 콘솔의 Key ID와 Secret을 아이디:시크릿처럼 한 줄로 붙여 넣으세요.";
  }
  return null;
}
