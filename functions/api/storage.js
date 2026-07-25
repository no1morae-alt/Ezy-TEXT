// Cloudflare Pages Function
// 경로: /api/storage  (public/index.html의 window.storage 폴리필이 이 엔드포인트를 호출합니다)
//
// 배포 전 준비할 것:
// 1. Cloudflare 대시보드 > Workers & Pages > KV 에서 네임스페이스 생성 (이름 예: instructor-email-kv)
// 2. Pages 프로젝트 > Settings > Functions > KV namespace bindings 에서
//    변수 이름: STORAGE_KV  → 방금 만든 네임스페이스 연결
//
// 저장 규칙:
// - personal(shared=false): "personal:{deviceId}:{key}" 로 저장 (이 브라우저에만 귀속)
// - shared(shared=true):    "shared:{key}" 로 저장 (모든 사용자가 공유)

function buildKvKey(deviceId, key, shared){
  if(shared) return `shared:${key}`;
  return `personal:${deviceId}:${key}`;
}

export async function onRequestPost(context){
  const { request, env } = context;

  if(!env.STORAGE_KV){
    return new Response(JSON.stringify({ error: 'STORAGE_KV binding이 설정되지 않았어요. Cloudflare Pages 설정에서 KV 네임스페이스를 연결해주세요.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let body;
  try{
    body = await request.json();
  }catch(e){
    return new Response(JSON.stringify({ error: '잘못된 요청입니다.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { action, deviceId, key, value, shared, prefix } = body;

  if(!deviceId){
    return new Response(JSON.stringify({ error: 'deviceId가 필요합니다.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  try{
    if(action === 'get'){
      if(!key) return new Response(JSON.stringify({ error: 'key가 필요합니다.' }), { status: 400 });
      const kvKey = buildKvKey(deviceId, key, shared);
      const raw = await env.STORAGE_KV.get(kvKey);
      return new Response(JSON.stringify({ value: raw === null ? null : raw }), { headers: { 'Content-Type': 'application/json' } });
    }

    if(action === 'set'){
      if(!key) return new Response(JSON.stringify({ error: 'key가 필요합니다.' }), { status: 400 });
      const kvKey = buildKvKey(deviceId, key, shared);
      await env.STORAGE_KV.put(kvKey, value);
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    if(action === 'delete'){
      if(!key) return new Response(JSON.stringify({ error: 'key가 필요합니다.' }), { status: 400 });
      const kvKey = buildKvKey(deviceId, key, shared);
      const existing = await env.STORAGE_KV.get(kvKey);
      await env.STORAGE_KV.delete(kvKey);
      return new Response(JSON.stringify({ deleted: existing !== null }), { headers: { 'Content-Type': 'application/json' } });
    }

    if(action === 'list'){
      const scopedPrefix = shared ? `shared:${prefix || ''}` : `personal:${deviceId}:${prefix || ''}`;
      const listResult = await env.STORAGE_KV.list({ prefix: scopedPrefix, limit: 1000 });
      const stripLen = shared ? 'shared:'.length : `personal:${deviceId}:`.length;
      const keys = listResult.keys.map(k => k.name.slice(stripLen));
      return new Response(JSON.stringify({ keys }), { headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: '알 수 없는 action입니다.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }catch(err){
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
