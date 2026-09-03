// ============================================================
// NFC-e helper — lê o QR do cupom (SEFAZ)
//
// O parâmetro "p" do QR tem formatos DIFERENTES por estado:
//  - MG (portalsped): pipe -> chave|nVersao|tpAmb|cDest|hash
//    (NÃO traz total; a página exige CAPTCHA/Turnstile)
//  - Outros estados (SP, RS...): base64 de JSON com chNFe/vNF/dhEmi
//    (aí o total vem direto do QR, sem depender da SEFAZ)
//
// Sempre que der, também tentamos a página pública p/ emitente/itens.
//
// Uso (POST JSON): { "url": "...qrcode...?p=..." } | { "p": "...", "uf": "mg" }
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

// URLs de consulta pública por estado (a URL completa do QR tem prioridade)
const UF_CONSULT: Record<string, string> = {
  mg: "https://portalsped.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml?p=",
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

// interpreta o "p" (vários formatos) e devolve o que der para extrair
function decodePayload(p: string) {
  // formato MG: chave|nVersao|tpAmb|cDest|hash
  if (p.includes("|")) {
    const parts = p.split("|").map((s) => s.trim());
    const chave = /^\d{44}$/.test(parts[0] || "") ? parts[0] : "";
    const dt = chave ? chaveAAMM(chave) : null;
    return {
      formato: "mg-pipe",
      chave: chave || null,
      chaveCurta: chave ? chave.slice(-8) : null,
      emissao: null,
      data: dt ? dt.data : null,
      total: null, // o MG não põe o total no QR
      icms: null,
      ambiente: parts[2] || null,
    };
  }
  // formato JSON em base64 (vários estados)
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(b64Decode(p));
  } catch {
    raw = {};
  }
  const chave = String(raw.chNFe || "").trim();
  const dhEmi = String(raw.dhEmi || "").trim();
  const vNF = Number(raw.vNF);
  return {
    formato: "json",
    chave: chave || null,
    chaveCurta: chave ? chave.slice(-8) : null,
    emissao: dhEmi || null,
    data: dhEmi.slice(0, 10) || null,
    total: isFinite(vNF) && vNF > 0 ? vNF : null,
    icms: isFinite(Number(raw.vICMS)) ? Number(raw.vICMS) : null,
    ambiente: String(raw.tpAmb || "1"),
  };
}

// extrai ano/mês da chave de acesso (posições 3-6: AAMM)
function chaveAAMM(chave: string) {
  const aamm = chave.slice(2, 6); // ex.: "2609"
  const ano = 2000 + Number(aamm.slice(0, 2));
  const mes = Number(aamm.slice(2, 4));
  return { data: ano + "-" + String(mes).padStart(2, "0") + "-01", ano, mes };
}

// baixa a página pública; detecta CAPTCHA e extrai emitente/itens/total
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
  const temCaptcha = /(re)?captcha|turnstile|cloudflare/i.test(html);
  let emitente = "";
  const mTitle = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (mTitle) emitente = mTitle[1].replace(/^\s+|\s+$/g, "");
  const itens: string[] = [];
  let totalPagina: number | null = null;
  if (!temCaptcha) {
    const re = />([^<>]{3,80}?)<\/[^>]+>[^<>]*?R\$\s?([\d.,]+)</gi;
    let mm: RegExpExecArray | null;
    let guard = 0;
    while ((mm = re.exec(html)) && guard++ < 80) {
      const d = mm[1].trim();
      const v = mm[2].trim().replace(/\./g, "").replace(",", ".");
      if (d && !/data|hora/i.test(d)) itens.push(d + " — R$ " + mm[2].trim());
    }
    const mTot = html.match(/Total\s*R\$\s?([\d.,]+)/i);
    if (mTot) totalPagina = Number(mTot[1].replace(/\./g, "").replace(",", "."));
  }
  return {
    url: res.url || url,
    status: res.status,
    captcha: temCaptcha,
    emitente: temCaptcha ? "" : emitente,
    itens: temCaptcha ? [] : itens,
    totalPagina,
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

    // consulta à página pública (emitente/itens) — pode exigir CAPTCHA
    let consulta: Awaited<ReturnType<typeof fetchPage>> | null = null;
    const consultUrl = url || (UF_CONSULT[uf] ? UF_CONSULT[uf] + encodeURIComponent(p) : "");
    if (consultUrl) {
      try {
        consulta = await fetchPage(consultUrl);
      } catch {
        consulta = null;
      }
    }

    const captcha = !!(consulta && consulta.captcha);
    return json(
      {
        ok: true,
        dados: {
          ...payload,
          emitente: (consulta && consulta.emitente) || "",
          itens: (consulta && consulta.itens) || [],
          totalPagina: (consulta && consulta.totalPagina) || null,
          captcha,
          aviso: captcha
            ? "A SEFAZ exigiu verificação (CAPTCHA) e bloqueou a consulta automática."
            : null,
          consultaOk: !!consulta && consulta.status === 200 && !captcha,
          pagina: (consulta && consulta.url) || consultUrl || null,
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
