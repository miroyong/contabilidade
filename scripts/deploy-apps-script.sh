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
#   3. Cria/atualiza o deployment (mantém a mesma URL /exec)
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

SCRIPT_ID="1CHsIJJSQMh4a6XpnuIjvCwYlqMnStq00m5DjSfUFVcMYpASDaLkUBOwS"
CLIENT_ID="1072944905499-vm2v2i5dvn0a0d2o4ca36i1vge8cvbn0.apps.googleusercontent.com"
CLIENT_SECRET="v6V3fKV_zWU7iw1DrpO1rknX"
CLASPRC="$HOME/.clasprc.json"

# ---------- token ----------
get_token() {
  python3 - "$CLASPRC" <<'PYEOF'
import json, sys, time, urllib.request, urllib.parse
p = sys.argv[1]
d = json.load(open(p))
tok = d['token']
if tok.get('expiry_date', 0) > (time.time() * 1000) + 60000:
    print(tok['access_token']); sys.exit(0)
# refresh
body = urllib.parse.urlencode({
    'grant_type': 'refresh_token',
    'client_id': d['oauth2ClientSettings']['clientId'],
    'client_secret': d['oauth2ClientSettings']['clientSecret'],
    'refresh_token': tok['refresh_token'],
}).encode()
req = urllib.request.Request('https://oauth2.googleapis.com/token', data=body)
r = json.load(urllib.request.urlopen(req, timeout=30))
tok['access_token'] = r['access_token']
tok['expiry_date'] = int(time.time() * 1000) + int(r.get('expires_in', 3600)) * 1000
json.dump(d, open(p, 'w'), indent=2)
print(r['access_token'])
PYEOF
}

TOKEN=$(get_token)
AUTH="Authorization: Bearer $TOKEN"
CT="Content-Type: application/json"

# ---------- montar payload ----------
python3 - <<'PYEOF'
import json
appsscript = json.load(open('apps-script/appsscript.json'))
code = open('apps-script/Code.gs', encoding='utf-8').read()
payload = {'files': [
    {'name': 'appsscript', 'type': 'JSON', 'source': json.dumps(appsscript)},
    {'name': 'Code', 'type': 'SERVER_JS', 'source': code}
]}
json.dump(payload, open('/tmp/deploy_payload.json', 'w'), ensure_ascii=False)
print('payload pronto')
PYEOF

# ---------- enviar conteúdo ----------
echo "1/3 enviando conteúdo..."
curl -sf --max-time 60 -X PUT "https://script.googleapis.com/v1/projects/$SCRIPT_ID/content" \
  -H "$AUTH" -H "$CT" --data @/tmp/deploy_payload.json -o /dev/null \
  || { echo "FALHA ao enviar conteúdo"; exit 1; }

# ---------- nova versão ----------
echo "2/3 criando versão..."
VERSION=$(curl -sf --max-time 30 -X POST "https://script.googleapis.com/v1/projects/$SCRIPT_ID/versions" \
  -H "$AUTH" -H "$CT" -d "{\"description\":\"redeploy $(date +%F-%H%M)\"}" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['versionNumber'])") \
  || { echo "FALHA ao criar versão"; exit 1; }
echo "versão: $VERSION"

# ---------- criar deployment (nova URL) ----------
echo "3/3 criando deployment..."
DEP=$(curl -sf --max-time 30 -X POST "https://script.googleapis.com/v1/projects/$SCRIPT_ID/deployments" \
  -H "$AUTH" -H "$CT" \
  -d "{\"versionNumber\":$VERSION,\"description\":\"web app controle financeiro\",\"manifestFileName\":\"appsscript\"}") \
  || { echo "FALHA ao criar deployment"; exit 1; }
URL=$(echo "$DEP" | python3 -c "
import json,sys
d = json.load(sys.stdin)
print(d['deploymentId'])
urls = [e.get('webapp',{}).get('url','') for e in d.get('entryPoints',[]) if e.get('entryPointType')=='WEB_APP']
print(urls[0] if urls else '')
")
echo "deploymentId: $(echo "$URL" | head -1)"
echo "URL: $(echo "$URL" | tail -1)"
echo "⚠️  Se a URL mudou, atualize o APPS_SCRIPT_URL no config.js."
echo "⚠️  A autorização pública: abra a URL logado(a) e autorize (ou use a UI: Implantar → Gerenciar implantações → ✏️ → Nova versão)."
rm -f /tmp/deploy_payload.json
