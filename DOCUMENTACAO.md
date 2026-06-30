# 📡 Radar de Vendas — Documentação do Projeto

> PoC de **prospecção de campo**: o vendedor tira foto da **fachada** de um comércio e recebe
> um **dossiê comercial** com inteligência de venda dos serviços NetTurbo.

**Pasta oficial:** `C:\Users\alan.moreira\Documents\00 - 2026\36 - PROSPECÇÃO APP`
**Status:** PoC no ar e **DEPLOYADO na VPS pessoal (30/06/2026)** via pm2 + Cloudflare Tunnel (HTTPS). Saiu do "PC ligado".
**Custo atual:** R$ 0 (Gemini free tier + Google Places crédito grátis).

---

## 1. O que o app faz (fluxo)

```
📸 Foto da fachada (+ GPS do celular)
        │
        ▼
👁️  VISÃO (Gemini)         → nome fantasia, ramo, telefone, CNPJ, site, redes, cidade
        │
        ▼
📍  GOOGLE PLACES           → confirma a empresa: nome oficial, telefone, site,
        │                      categoria, horário, avaliações, link do Maps
        ▼
🌐  IA LÊ O SITE (Gemini)   → resumo, serviços, porte, indícios de TI, e-mail, redes,
        │                      CNPJ (se no rodapé), SCORE DE OPORTUNIDADE, serviços-alvo,
        │                      GANCHO de abordagem pronto pro vendedor
        ▼
🏢  RECEITA (BrasilAPI)     → quando há CNPJ: razão social, sócios, CNAE, porte, capital
        │
        ▼
🛰️  GPS (Nominatim)         → endereço/cidade reais da localização
        │
        ▼
📋  DOSSIÊ DE VENDAS no celular
```

---

## 2. Arquitetura técnica

- **Backend:** Node.js + Express (`server.js`), ES modules. Porta **4500**.
- **Frontend:** HTML/CSS/JS vanilla, mobile-first (`public/index.html`). Câmera via `<input capture>`.
- **Acesso externo:** **Cloudflare Tunnel** (`cloudflared`) do PC local → URL HTTPS pública
  (a câmera do celular exige HTTPS). Sem domínio, sem nginx, sem abrir porta.
- **IA:** Google **Gemini** (modelo `gemini-2.5-flash`). 2 chamadas por análise (fachada + site).
- **Enriquecimento:** Google **Places API (New)**, **BrasilAPI** (CNPJ), **Nominatim/OpenStreetMap** (GPS).

### Arquivos
| Arquivo | Papel |
|---|---|
| `server.js` | API + orquestração de todas as etapas |
| `public/index.html` | App mobile (câmera, GPS, cards do dossiê) |
| `.env` | Chaves (não versionar) |
| `.env.example` | Modelo das chaves |
| `README.md` | Como rodar |
| `DOCUMENTACAO.md` | Este documento |

### Endpoint
`POST /api/analisar` — body `{ imagem(base64), mime, lat, lng }` →
retorna `{ fachada, places, inteligencia, cnpj, cnpj_origem, endereco_gps, cidade_usada, site_analisado }`.

### Funções-chave (`server.js`)
- `chamarGeminiJSON(parts)` — helper genérico Gemini → JSON.
- `lerFachada(base64, mime)` — visão da placa.
- `buscarPlaces(nome, ramo, cidade)` — Places New (query = nome+ramo+cidade, pt-BR/BR, sem bias de GPS).
- `analisarSite(site, nome, ramo)` — busca páginas do site, limpa HTML, manda pro Gemini → inteligência + score.
- `enriquecerCnpj(cnpj)` — BrasilAPI.
- `enderecoPorGps(lat,lng)` / `ufSigla()` — Nominatim + cidade/UF.
- `PORTFOLIO_NETTURBO` — lista de serviços usada no score (AJUSTAR para os nomes reais).

---

## 3. Como rodar

```powershell
cd "C:\Users\alan.moreira\Documents\00 - 2026\36 - PROSPECÇÃO APP"
npm install
copy .env.example .env      # preencher GEMINI_API_KEY (e GOOGLE_PLACES_API_KEY)
npm start                   # http://localhost:4500
```

### Expor pro celular (Cloudflare Tunnel)
```powershell
cloudflared tunnel --url http://localhost:4500
# copia a URL https://....trycloudflare.com e abre no celular
```
> A URL do *quick tunnel* é temporária (muda a cada execução). Para URL fixa, usar túnel nomeado
> (exige domínio gerenciado no Cloudflare).

### Deploy em produção na VPS (feito 30/06/2026)
- **VPS pessoal:** `217.196.61.190` (srv1121163), app em `/opt/radar-vendas`. Repo
  `github.com/alankardecm/radar-vendas` (branch `main`).
- **Passos na VPS:** `git clone` → `npm install` → criar `.env` (GEMINI_API_KEY, GOOGLE_PLACES_API_KEY,
  `GEMINI_MODEL=gemini-2.5-flash`, `PORT=4500`) → `pm2 start server.js --name radar-vendas && pm2 save`.
- **HTTPS:** `cloudflared` (instalado via repo apt oficial) como **quick tunnel** rodando no pm2:
  `pm2 start cloudflared --name radar-tunnel -- tunnel --url http://localhost:4500 && pm2 save`.
  A URL `https://....trycloudflare.com` aparece só no início do log e **muda a cada restart** —
  pegar com: `grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' /root/.pm2/logs/radar-tunnel-*.log`.
- **Processos pm2:** `radar-vendas` (app) + `radar-tunnel` (HTTPS), ambos em `pm2 save` (sobrevivem a reboot).
- **GOTCHAs:** warnings de ICMP/`ping_group_range` do cloudflared são inofensivos; `.env`/`.env.example`
  tinham chaves reais → sanitizado (`.env` no `.gitignore`, placeholders no exemplo).
- **Pendente:** URL FIXA via túnel nomeado (precisa domínio no Cloudflare); afinar `PORTFOLIO_NETTURBO`;
  botão "Salvar oportunidade" no CRM/FUNTER.

### Chaves (.env)
| Variável | Obrigatória | Onde pegar | Observação |
|---|---|---|---|
| `GEMINI_API_KEY` | ✅ | https://aistudio.google.com/apikey | Grátis |
| `GEMINI_MODEL` | — | — | Usar `gemini-2.5-flash` (ver gotcha) |
| `GOOGLE_PLACES_API_KEY` | recomendada | Google Cloud → Places API (New) | Crédito grátis US$200/mês, exige billing |
| `PORT` | — | — | Default 4500 |

---

## 4. Decisões e descobertas (histórico)

### Sobre CNPJ por nome — o ponto mais difícil
A fachada dá o **nome**, não o CNPJ. Buscar **nome → CNPJ** é o gargalo:
- **BrasilAPI / ReceitaWS / Minha Receita:** grátis, mas só **por CNPJ**.
- **Casa dos Dados:** tem busca por nome, mas **Cloudflare bloqueia** automação (403). Removida do fluxo.
- **CPF.CNPJ (Pacote 4, `/4/?razao_social=`):** faz por nome, **R$ 0,15/consulta**. Recusado:
  contrato cláusula **10.3.c proíbe armazenar/reproduzir telas com dados** (conflita com salvar no CRM),
  **8.1** veda empresas de serviços de informação/cobrança, e o contratante vira **controlador LGPD**.
- **Self-host dos Dados Abertos da Receita:** grátis e ilimitado, mas **~50-70GB + horas de import + PC ligado**.
  Layout/caminho dos arquivos mudou em jan/2026 (agora via WebDAV com token). **Adiado.**

**Conclusão:** não existe fonte **nome→CNPJ grátis e automatizável**. Por isso o **pivô** abaixo.

### Pivô para IA lendo o site (decisão atual)
Em vez de perseguir o CNPJ, o app extrai **inteligência comercial** do site da empresa com o Gemini,
gerando **score de oportunidade** e **gancho de abordagem** — mais útil para vendas que o CNPJ cru,
100% grátis, sem infra. O CNPJ ainda aparece quando a fachada ou o site expõem o número (comum em PMEs).

### Gotchas registrados
- **Gemini:** no projeto do Alan, `gemini-2.0-flash` está com cota free **zerada** (429 limit:0).
  Usar **`gemini-2.5-flash`**.
- **GPS de foto do note:** pega a posição **atual**, não a do local da foto. Em campo (celular na fachada) fica correto.
- **Sites grandes com WAF** (ex.: hospitalveracruz) bloqueiam a leitura (403) → fallback `site_inacessivel`,
  usa só o Places. PMEs (WordPress/Wix) normalmente liberam.
- **Places:** usar query `nome + ramo + cidade` e **não** enviesar por GPS, senão casa com a rua errada.

---

## 5. Status atual (29/06/2026)

| Item | Status |
|---|---|
| Visão da fachada (Gemini) | ✅ |
| Google Places enriquecido | ✅ |
| IA lê o site → score + gancho | ✅ |
| CNPJ via fachada/site → BrasilAPI | ✅ |
| GPS → cidade/UF/endereço | ✅ |
| Acesso no celular (HTTPS via túnel) | ✅ |
| Deploy na VPS (pm2 + cloudflared) | ✅ 30/06 |
| Self-host base Receita (nome→CNPJ) | ⏸️ adiado |

---

## 6. Próximos passos

1. **Afinar `PORTFOLIO_NETTURBO`** em `server.js` com os serviços e nomes comerciais reais.
2. **Botão "Salvar oportunidade"** → gravar dossiê + score no CRM/FUNTER (definir destino).
3. ~~Sair do "PC ligado"~~ ✅ feito (VPS 30/06). Falta **URL fixa** (túnel nomeado, exige domínio Cloudflare).
4. **Decidir o produto:** módulo no Hub (`/radar-vendas`) ou app standalone (linha do AM OS).
5. (Opcional) Retomar **self-host Receita** se o CNPJ garantido por nome virar requisito.
6. Refinar prompt do score por **segmento** (clínica, varejo, indústria…) e validar em campo.
