// Cloudflare Pages Function
// 경로: /api/storage  (public/index.html의 window.storage 폴리필이 이 엔드포인트를 호출합니다)
//
// 배포 전 준비할 것:
// 1. Cloudflare 대시보드 > Workers & Pages > KV 에서 네임스페이스 생성 (이름 예: instructor-email-kv)
// 2. Pages 프로젝트 > Settings > Functions > KV namespace bindings 에서
//    변수 이름: STORAGE_KV  → 방금 만든 네임스페이스 연결
// 3. Pages 프로젝트 > Settings > Environment variables (Secret) 에서
//    변수 이름: SESSION_SECRET → 임의의 긴 랜덤 문자열 (세션 토큰 서명용, 노출되면 안 됨)
//
// 저장 규칙:
// - personal(shared=false): "personal:{deviceId}:{key}" 로 저장 (이 브라우저에만 귀속)
// - shared(shared=true):    "shared:{key}" 로 저장 (모든 사용자가 공유)
// - member(memberId 지정):  "member:{memberId}:{key}" 로 저장 - 유효한 세션 토큰으로 그 memberId 본인임이
//                           확인된 요청에서만 허용됩니다 (토큰이 없거나 다른 회원 것이면 personal 범위로 조용히 낮춰요).
//
// 회원 목록(signup-members-v1)은 이메일+비밀번호 해시를 담고 있어서 일반 get/set/list/delete로는
// 접근할 수 없게 막아두고, 아래 전용 액션(membersGet/membersSignup/membersLogin/membersUpdate/
// membersForgotReset)으로만 다루도록 분리했습니다 - 비밀번호 해시는 절대 클라이언트로 내려주지 않습니다.

const MEMBERS_KEY = 'signup-members-v1';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30일
const ADMIN_SENTINEL_ID = '__admin__';

function buildKvKey(deviceId, key, shared, memberId){
  if(shared) return `shared:${key}`;
  if(memberId) return `member:${memberId}:${key}`;
  return `personal:${deviceId}:${key}`;
}

function json(data, status = 200){
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function b64urlEncode(buf){
  let bin = '';
  const bytes = new Uint8Array(buf);
  for(let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmacKey(env){
  if(!env.SESSION_SECRET){
    throw new Error('SESSION_SECRET이 설정되지 않았어요. Cloudflare Pages 환경변수를 확인해주세요.');
  }
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function signToken(env, memberId){
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = `${memberId}.${exp}`;
  const key = await hmacKey(env);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return `${payload}.${b64urlEncode(sig)}`;
}

// 토큰이 유효하고 만료되지 않았으면 그 안에 서명된 memberId를 반환하고, 아니면 null을 반환해요.
// (클라이언트가 보낸 memberId를 그대로 믿지 않고, 토큰 안에 서버가 직접 서명한 값만 신뢰합니다.)
async function verifyToken(env, token){
  if(typeof token !== 'string') return null;
  const parts = token.split('.');
  if(parts.length !== 3) return null;
  const [memberId, expStr, sigB64] = parts;
  const exp = Number(expStr);
  if(!Number.isFinite(exp) || Date.now() > exp) return null;
  try{
    const key = await hmacKey(env);
    const expectedSig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${memberId}.${expStr}`));
    const expectedB64 = b64urlEncode(expectedSig);
    if(expectedB64.length !== sigB64.length) return null;
    let diff = 0;
    for(let i = 0; i < expectedB64.length; i++) diff |= expectedB64.charCodeAt(i) ^ sigB64.charCodeAt(i);
    return diff === 0 ? memberId : null;
  }catch(e){
    return null;
  }
}

async function loadRawMembers(env){
  const raw = await env.STORAGE_KV.get(`shared:${MEMBERS_KEY}`);
  return raw ? JSON.parse(raw) : [];
}

async function saveRawMembers(env, members){
  await env.STORAGE_KV.put(`shared:${MEMBERS_KEY}`, JSON.stringify(members));
}

function stripHash(member){
  const { passwordHash, ...rest } = member;
  return rest;
}

export async function onRequestPost(context){
  const { request, env } = context;

  if(!env.STORAGE_KV){
    return json({ error: 'STORAGE_KV binding이 설정되지 않았어요. Cloudflare Pages 설정에서 KV 네임스페이스를 연결해주세요.' }, 500);
  }

  let body;
  try{
    body = await request.json();
  }catch(e){
    return json({ error: '잘못된 요청입니다.' }, 400);
  }

  const { action, deviceId, key, value, shared, prefix, memberId, sessionToken, adminToken } = body;

  // ---- 관리자 로그인 (더 이상 클라이언트 JS에 비밀번호를 하드코딩하지 않아요) ----
  if(action === 'adminLogin'){
    const { password } = body;
    if(!env.ADMIN_PASSWORD){
      return json({ error: 'ADMIN_PASSWORD가 설정되지 않았어요. Cloudflare Pages 환경변수를 확인해주세요.' }, 500);
    }
    if(password !== env.ADMIN_PASSWORD){
      return json({ error: '비밀번호가 올바르지 않습니다.' }, 401);
    }
    const token = await signToken(env, ADMIN_SENTINEL_ID);
    return json({ token });
  }

  if(action === 'membersAdminDelete'){
    const verifiedId = await verifyToken(env, adminToken);
    if(verifiedId !== ADMIN_SENTINEL_ID){
      return json({ error: '관리자 인증이 필요합니다.' }, 401);
    }
    const { targetMemberId } = body;
    if(!targetMemberId) return json({ error: 'targetMemberId가 필요합니다.' }, 400);
    const members = await loadRawMembers(env);
    const filtered = members.filter(m => m.id !== targetMemberId);
    await saveRawMembers(env, filtered);
    return json({ ok: true });
  }

  // ---- 회원 목록 전용 액션 (비밀번호 해시는 여기서만 다루고, 응답에는 절대 포함하지 않아요) ----
  if(action === 'membersGet'){
    const members = await loadRawMembers(env);
    return json({ members: members.map(stripHash) });
  }

  if(action === 'membersSignup'){
    const { name, email, passwordHash } = body;
    if(!name || !email || !passwordHash){
      return json({ error: '이름/이메일/비밀번호가 필요합니다.' }, 400);
    }
    const members = await loadRawMembers(env);
    const existing = members.find(m => m.email.toLowerCase() === email.toLowerCase() && !m.withdrawnAt);
    if(existing){
      return json({ error: '이미 가입된 이메일이에요. 로그인을 이용해주세요.' }, 409);
    }
    const now = new Date().toISOString();
    const member = {
      id: crypto.randomUUID(), name, email, passwordHash,
      registeredAt: now, lastAccessAt: now, lastActiveAt: now, visitCount: 1, withdrawnAt: null
    };
    members.push(member);
    await saveRawMembers(env, members);
    const token = await signToken(env, member.id);
    return json({ member: stripHash(member), token });
  }

  if(action === 'membersLogin'){
    const { email, passwordHash } = body;
    if(!email || !passwordHash){
      return json({ error: '이메일/비밀번호가 필요합니다.' }, 400);
    }
    const members = await loadRawMembers(env);
    const member = members.find(m => m.email.toLowerCase() === email.toLowerCase());
    if(!member || member.withdrawnAt || member.passwordHash !== passwordHash){
      return json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' }, 401);
    }
    member.visitCount = (member.visitCount || 1) + 1;
    member.lastAccessAt = new Date().toISOString();
    member.lastActiveAt = member.lastAccessAt;
    await saveRawMembers(env, members);
    const token = await signToken(env, member.id);
    return json({ member: stripHash(member), token });
  }

  // 참고: 이메일 소유 확인(인증 메일 발송 등) 절차가 없어서, 이메일만 알면 비밀번호를 재설정할 수 있는
  // 구조적 한계가 있어요. 실제 이메일 인증을 붙이기 전까지는 남아있는 리스크입니다.
  if(action === 'membersForgotReset'){
    const { targetMemberId, passwordHash } = body;
    if(!targetMemberId || !passwordHash){
      return json({ error: '요청이 올바르지 않습니다.' }, 400);
    }
    const members = await loadRawMembers(env);
    const idx = members.findIndex(m => m.id === targetMemberId);
    if(idx === -1){
      return json({ error: '회원 정보를 찾을 수 없어요.' }, 404);
    }
    members[idx].passwordHash = passwordHash;
    await saveRawMembers(env, members);
    return json({ ok: true });
  }

  if(action === 'membersUpdate'){
    const verifiedId = await verifyToken(env, sessionToken);
    if(!verifiedId){
      return json({ error: '세션이 만료되었어요. 다시 로그인해주세요.' }, 401);
    }
    const members = await loadRawMembers(env);
    const idx = members.findIndex(m => m.id === verifiedId);
    if(idx === -1){
      return json({ error: '회원 정보를 찾을 수 없어요.' }, 404);
    }
    const { set: setFields, increment: incFields } = body;
    if(setFields && typeof setFields === 'object'){
      for(const k of ['nickname', 'passwordHash', 'withdrawnAt', 'lastActiveAt', 'lastAccessAt']){
        if(k in setFields) members[idx][k] = setFields[k];
      }
    }
    if(incFields && typeof incFields === 'object'){
      for(const k of ['totalActiveMs', 'visitCount']){
        if(k in incFields) members[idx][k] = (members[idx][k] || 0) + Number(incFields[k] || 0);
      }
    }
    await saveRawMembers(env, members);
    return json({ member: stripHash(members[idx]) });
  }

  // 회원 목록 키는 위 전용 액션으로만 접근 가능해요 (일반 get/set/list/delete로는 완전히 차단).
  if(key === MEMBERS_KEY && shared){
    return json({ error: '이 키는 전용 액션으로만 접근할 수 있어요.' }, 403);
  }

  if(!deviceId){
    return json({ error: 'deviceId가 필요합니다.' }, 400);
  }

  // memberId가 지정된 요청은, 유효한 세션 토큰이 정확히 그 memberId로 서명되어 있을 때만
  // 회원 범위(member:{memberId}:...) 데이터에 접근하게 해줘요. 토큰이 없거나 다른 회원의 것이면
  // (스푸핑 시도) 조용히 개인(기기) 범위로 낮춰서 처리해서, 절대 남의 데이터에 닿지 않게 합니다.
  let effectiveMemberId = null;
  if(memberId){
    const verifiedId = await verifyToken(env, sessionToken);
    effectiveMemberId = (verifiedId && verifiedId === memberId) ? memberId : null;
  }

  try{
    if(action === 'get'){
      if(!key) return json({ error: 'key가 필요합니다.' }, 400);
      const kvKey = buildKvKey(deviceId, key, shared, effectiveMemberId);
      const raw = await env.STORAGE_KV.get(kvKey);
      return json({ value: raw === null ? null : raw });
    }

    if(action === 'set'){
      if(!key) return json({ error: 'key가 필요합니다.' }, 400);
      const kvKey = buildKvKey(deviceId, key, shared, effectiveMemberId);
      await env.STORAGE_KV.put(kvKey, value);
      return json({ ok: true });
    }

    if(action === 'delete'){
      if(!key) return json({ error: 'key가 필요합니다.' }, 400);
      const kvKey = buildKvKey(deviceId, key, shared, effectiveMemberId);
      const existing = await env.STORAGE_KV.get(kvKey);
      await env.STORAGE_KV.delete(kvKey);
      return json({ deleted: existing !== null });
    }

    if(action === 'list'){
      const scopedPrefix = shared
        ? `shared:${prefix || ''}`
        : (effectiveMemberId ? `member:${effectiveMemberId}:${prefix || ''}` : `personal:${deviceId}:${prefix || ''}`);
      const listResult = await env.STORAGE_KV.list({ prefix: scopedPrefix, limit: 1000 });
      const stripLen = shared
        ? 'shared:'.length
        : (effectiveMemberId ? `member:${effectiveMemberId}:`.length : `personal:${deviceId}:`.length);
      const keys = listResult.keys.map(k => k.name.slice(stripLen));
      return json({ keys });
    }

    return json({ error: '알 수 없는 action입니다.' }, 400);
  }catch(err){
    return json({ error: String(err) }, 500);
  }
}
