// Cloudflare Pages Function — 경로: /api/visits
// 페이지 로드 시 POST로 호출해 총 방문자수를 1 증가시키고, 최신 값을 반환합니다.
// 필요한 설정: Pages 프로젝트 > Settings > Functions > KV namespace bindings
//   변수 이름: STORAGE_KV (기존 저장소와 동일한 네임스페이스 재사용, shared:site-visits-v1 키 사용)

const VISITS_KEY = "shared:site-visits-v1";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.STORAGE_KV) return json({ error: "STORAGE_KV binding이 설정되지 않았습니다." }, 500);
  const raw = await env.STORAGE_KV.get(VISITS_KEY);
  return json({ count: raw ? parseInt(raw, 10) || 0 : 0 });
}

export async function onRequestPost(context) {
  const { env } = context;
  if (!env.STORAGE_KV) return json({ error: "STORAGE_KV binding이 설정되지 않았습니다." }, 500);
  const raw = await env.STORAGE_KV.get(VISITS_KEY);
  const count = (raw ? parseInt(raw, 10) || 0 : 0) + 1;
  await env.STORAGE_KV.put(VISITS_KEY, String(count));
  return json({ count });
}
