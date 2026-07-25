// Cloudflare Pages Function
// 경로: /api/generate  (✨ AI 생성 버튼이 이 엔드포인트를 호출합니다)
//
// 배포 전 준비할 것:
// Cloudflare 대시보드 > Pages 프로젝트 > Settings > Environment variables 에서
//   변수 이름: ANTHROPIC_API_KEY  (Encrypt 체크) → https://console.anthropic.com 에서 발급받은 키 입력
//
// 이 파일이 브라우저 대신 Anthropic API를 호출해서, API 키가 사용자 화면(자바스크립트)에
// 노출되지 않도록 안전하게 감춰줍니다.

export async function onRequestPost(context){
  const { request, env } = context;

  if(!env.ANTHROPIC_API_KEY){
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY가 설정되지 않았어요. Cloudflare Pages 환경변수를 확인해주세요.' }), {
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

  if(!body.messages){
    return new Response(JSON.stringify({ error: 'messages가 필요합니다.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  try{
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        messages: body.messages
      })
    });

    const data = await anthropicRes.json();
    return new Response(JSON.stringify(data), {
      status: anthropicRes.status,
      headers: { 'Content-Type': 'application/json' }
    });
  }catch(err){
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
