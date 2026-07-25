// Cloudflare Pages Function
// 경로: /api/generate

export async function onRequestPost(context){
  const { request, env } = context;

  if(!env.GEMINI_API_KEY){
    return new Response(JSON.stringify({ error: 'GEMINI_API_KEY가 설정되지 않았어요. Cloudflare Pages 환경변수를 확인해주세요.' }), {
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
    const contents = body.messages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));

    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: contents
      })
    });

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      return new Response(JSON.stringify(data), {
        status: geminiRes.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const formattedResponse = {
      content: [
        { type: 'text', text: generatedText }
      ]
    };

    return new Response(JSON.stringify(formattedResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }catch(err){
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
