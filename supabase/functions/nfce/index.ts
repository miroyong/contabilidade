// ============================================================
// NFC-e helper — lê o QR do cupom (Ministério da Fazenda/SEFAZ)
//
// O QR da NFC-e contém uma URL de consulta com o parâmetro "p":
// um JSON em base64 com a chave, data e TOTAL da nota (vNF).
// 1) Decodificamos "p" -> total/data/chave SEM depender da SEFAZ.
// 2) Best-effort: consultamos a página pública p/ tentar pegar o
//    emitente e os itens (pode variar por estado e falhar/captcha).
//
// Uso (POST JSON):
//   { "url": "https://www.sefaz.mg.gov.br/nfce/qrcode?p=..." }  ou
//   { "p": "<base64>", "uf": "mg" }
// ============================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}

// padrões comuns de consulta pública NFC-e (podem mudar por estado);
// a URL completa vinda do cupom tem prioridade sobre este mapa
const UF_CONSULT: Record<string, string> = {
  mg: "https://www.sefaz.mg.gov.br/nfce/qrcode?p=",
  sp: "https://www.nfce.fazenda.sp.gov.br/qrcode?p=",
  rs: "https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx?p=",
  ba: "https://www.sefaz.ba.gov.br/nfce/qrcode?p=",
};

function b64Decode(s: string): string {
  let t = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  const bin = atob(t);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// extrai campos úteis do JSON contido no "p" do QR
function decodePayload(p: string) {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(b64Decode(p));
  } catch {
    raw = {}; // alguns layouts podem vir cifrados/regionais — segue sem detalhes
  }
  const chave = String(raw.chNFe || "").trim();
  const dhEmi = String(raw.dhEmi || "").trim();
  const vNF = Number(raw.vNF);
  const vICMS = Number(raw.vICMS);
  const data = dhEmi.slice(0, 10); // yyyy-mm-dd
  return {
    chave: chave || null,
    chaveCurta: chave ? chave.slice(-8) : null,
    emissao: dhEmi || null,
    data: data || null,
    total: isFinite(vNF) && vNF > 0 ? vNF : null,
    icms: isFinite(vICMS) ? vICMS : null,
    ambiente: String(raw.tpAmb || "1"),
  };
}

// tenta baixar a página pública e extrair emitente + itens (best-effort)
async function fetchPage(url: string) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
    },
    redirect: "follow",
  });
  const html = await res.text();
  let emitente = "";
  const mTitle = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (mTitle) emitente = mTitle[1].replace(/^\s+|\s+$/g, "");
  const itens: string[] = [];
  // heurística simples: linhas com descrição e valor monetário (formato BR)
  const re = />([^<>]{3,80}?)<\/[^>]+>[^<>]*?R\$\s?([\d.,]+)</gi;
  let mm: RegExpExecArray | null;
  let guard = 0;
  while ((mm = re.exec(html)) && guard++ < 60) {
    const d = mm[1].trim();
    const v = mm[2].trim();
    if (d && !/data|hora|n\.?\s?/i.test(d)) itens.push(d + " — R$ " + v);
  }
  return {
    url: res.url || url,
    status: res.status,
    emitente,
    itens,
    temConteudo: html.length > 0,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const url = String((body as any).url || "").trim();
    let p = String((body as any).p || "").trim();
    const uf = String((body as any).uf || "mg").toLowerCase();

    if (!p && url) {
      try {
        const u = new URL(url);
        const qp = u.searchParams.get("p");
        if (qp) p = qp;
      } catch { /* url inválida */ }
    }
    if (!p) {
      return json(
        { ok: false, erro: 'Informe a URL do QR da NFC-e ou o parâmetro "p".' },
        400,
        CORS,
      );
    }

    const payload = decodePayload(p);

    // consulta à página pública (opcional): emitente + itens
    let consulta: Awaited<ReturnType<typeof fetchPage>> | null = null;
    const consultUrl = url || (UF_CONSULT[uf] ? UF_CONSULT[uf] + encodeURIComponent(p) : "");
    if (consultUrl) {
      try {
        consulta = await fetchPage(consultUrl);
      } catch {
        consulta = null;
      }
    }

    return json(
      {
        ok: true,
        dados: {
          ...payload,
          emitente: consulta?.emitente || "",
          itens: consulta?.itens || [],
          consultaOk: !!consulta && consulta.status === 200,
          pagina: consulta?.url || consultUrl || null,
        },
      },
      200,
      CORS,
    );
  } catch (e) {
    return json(
      { ok: false, erro: String((e as Error).message || e) },
      500,
      CORS,
    );
  }
});
