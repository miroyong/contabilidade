#!/bin/bash
# ============================================================
# Redeploy do Apps Script via API (Google Apps Script API)
# Uso: bash scripts/deploy-apps-script.sh
#
# Pré-requisitos:
#   - ~/.clasprc.json com token OAuth (gerado no deploy inicial)
#   - API do Apps Script ativada (script.google.com/home/usersettings)
#
# O que faz:
#   1. Envia apps-script/Code.gs + apps-script/appsscript.json
#   2. Cria nova versão
#   3. ATUALIZA o deployment web app existente (mantém a MESMA URL /exec
#      e a autorização pública já concedida)
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

SCRIPT_ID="1CHsIJJSQMh4a6XpnuIjvCwYlqMnStq00m5DjSfUFVcMYpASDaLkUBOwS"
API="https://script.googleapis.com/v1/projects/$SCRIPT_ID"
CLASPRC="$HOME/.clasprc.json"
PAYLOAD="$HOME/.deploy_payload.json"

# ---------- token (renova via refresh_token se expirou) ----------
get_token() {
  python3 - "$CLASPRC" <<'PYEOF'
import json, sys, time, urllib.request, urllib.parse
d = json.load(open(sys.argv[1]))
tok = d['token']
if tok.get('expiry_date', 0) > (time.time() * 1000) + 60000:
    print(tok['access_token']); sys.exit(0)
body = urllib.parse.urlencode({
    'grant_type': 'refresh_token',
    'client_id': d['oauth2ClientSettings']['clientId'],
    'client_secret': d['oauth2ClientSettings']['clientSecret'],
    'refresh_token': tok['refresh_token'],
}).encode()
r = json.load(urllib.request.urlopen(
    urllib.request.Request('https://oauth2.googleapis.com/token', data=body), timeout=30))
tok['access_token'] = r['access_token']
tok['expiry_date'] = int(time.time() * 1000) + int(r.get('expires_in', 3600)) * 1000
json.dump(d, open(sys.argv[1], 'w'), indent=2)
print(r['access_token'])
PYEOF
}

TOKEN=$(get_token)
AUTH="Authorization: Bearer $TOKEN"
CT="Content-Type: application/json"

# ---------- montar payload ----------
python3 - "$PAYLOAD" <<'PYEOF'
import json, sys
appsscript = json.load(open('apps-script/appsscript.json'))
code = open('apps-script/Code.gs', encoding='utf-8').read()
json.dump({'files': [
    {'name': 'appsscript', 'type': 'JSON', 'source': json.dumps(appsscript)},
    {'name': 'Code', 'type': 'SERVER_JS', 'source': code}
]}, open(sys.argv[1], 'w'), ensure_ascii=False)
print('payload pronto')
PYEOF

# ---------- enviar conteúdo ----------
echo "1/4 enviando conteúdo..."
curl -sf --max-time 60 -X PUT "$API/content" -H "$AUTH" -H "$CT" \
  --data @"$PAYLOAD" -o /dev/null \
  || { echo "FALHA ao enviar conteúdo"; exit 1; }

# ---------- nova versão ----------
echo "2/4 criando versão..."
VERSION=$(curl -sf --max-time 30 -X POST "$API/versions" -H "$AUTH" -H "$CT" \
  -d "{\"description\":\"redeploy $(date +%F-%H%M)\"}" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['versionNumber'])") \
  || { echo "FALHA ao criar versão"; exit 1; }
echo "versão: $VERSION"

# ---------- achar o deployment web app atual (pula o HEAD sem versão) ----------
echo "3/4 localizando deployment atual..."
DEP_ID=$(curl -sf --max-time 30 "$API/deployments" -H "$AUTH" | python3 -c "
import json,sys
for dep in json.load(sys.stdin).get('deployments', []):
    if dep.get('deploymentConfig', {}).get('versionNumber') is None:
        continue  # deployment HEAD criado pelo editor — não atualiza
    for ep in dep.get('entryPoints', []):
        if ep.get('entryPointType') == 'WEB_APP':
            print(dep['deploymentId']); sys.exit(0)
") || { echo "FALHA ao listar deployments"; exit 1; }
echo "deploymentId atual: $DEP_ID"

# ---------- atualizar o deployment (mantém a URL /exec) ----------
echo "4/4 atualizando deployment..."
RESP=$(curl -sf --max-time 30 -X PUT "$API/deployments/$DEP_ID" -H "$AUTH" -H "$CT" \
  -d "{\"deploymentConfig\":{\"versionNumber\":$VERSION,\"description\":\"web app controle financeiro\",\"scriptId\":\"$SCRIPT_ID\",\"manifestFileName\":\"appsscript\"}}") \
  || { echo "FALHA ao atualizar deployment"; exit 1; }
URL=$(echo "$RESP" | python3 -c "
import json,sys
d = json.load(sys.stdin)
for ep in d.get('entryPoints', []):
    if ep.get('entryPointType') == 'WEB_APP':
        print(ep['webApp']['url']); sys.exit(0)
")
echo "URL (inalterada): $URL"
echo "✅ Redeploy via API concluído. URL mantida."
echo "⚠️  IMPORTANTE: o Google SÓ reativa o acesso público quando a nova versão é"
echo "    publicada pela UI. Após rodar este script, faça (1 min):"
echo "    editor do script → Implantar → Gerenciar implantações → ✏️ →"
echo "    Versão: Nova versão → Implantar → Revisar permissões → Avançado → Acessar → Permitir"
echo "    (abrir a URL /exec logado NÃO reativa o acesso anônimo)."
rm -f "$PAYLOAD"
